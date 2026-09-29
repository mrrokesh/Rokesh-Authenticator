import { useState } from 'react';
import { AppState, Pressable, Text, type AppStateStatus } from 'react-native';
import { act, render, screen, userEvent } from '@testing-library/react-native';
import { LockGate, RELOCK_AFTER_MS } from '../components/LockGate';
import { useEnrollment } from '../components/EnrollmentContext';
import { confirmUserPresence } from '../services/biometrics';

jest.mock('../components/EnrollmentContext', () => ({ useEnrollment: jest.fn() }));
jest.mock('../services/biometrics', () => ({ confirmUserPresence: jest.fn() }));

const mockUseEnrollment = useEnrollment as jest.Mock;
const mockConfirm = confirmUserPresence as jest.Mock;

const enrollment = {
  deviceId: 'd1',
  publicKey: 'pk',
  employee: { id: 'e1', name: 'Alice', email: 'alice@example.test' },
  totp: { secret: 'JBSWY3DPEHPK3PXP', issuer: 'MR ROKESH', accountName: 'alice', algorithm: 'SHA1', digits: 6, period: 30 },
  enrolledAt: '2026-01-01T00:00:00Z',
};

// Drive AppState ourselves; other components subscribe too, so fan out to every listener.
let listeners: Array<(s: AppStateStatus) => void> = [];
const emitAppState = (s: AppStateStatus) => listeners.forEach((l) => l(s));
beforeEach(() => {
  listeners = [];
  mockConfirm.mockReset();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    const l = cb as (s: AppStateStatus) => void;
    listeners.push(l);
    return { remove: () => (listeners = listeners.filter((x) => x !== l)) } as never;
  });
});
afterEach(() => jest.restoreAllMocks());

/** Stateful child: proves whether the content underneath was kept mounted. */
function Counter() {
  const [n, setN] = useState(0);
  return (
    <Pressable accessibilityRole="button" onPress={() => setN(n + 1)}>
      <Text>count {n}</Text>
    </Pressable>
  );
}

const setup = async () => {
  await render(
    <LockGate>
      <Counter />
    </LockGate>,
  );
};

test('no lock before the device is enrolled', async () => {
  mockUseEnrollment.mockReturnValue({ enrollment: null, loading: false });
  await setup();
  expect(screen.queryByTestId('lock-overlay')).toBeNull();
  expect(mockConfirm).not.toHaveBeenCalled();
});

test('prompts for biometrics on launch and stays locked if cancelled', async () => {
  mockUseEnrollment.mockReturnValue({ enrollment, loading: false });
  mockConfirm.mockResolvedValue(false);
  await setup();
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
  expect(screen.getByText('Locked')).toBeOnTheScreen();
  // content underneath is hidden from screen readers while locked
  expect(screen.queryByRole('button', { name: /count/ })).toBeNull();
});

test('shows the screen-lock error instead of unlocking', async () => {
  mockUseEnrollment.mockReturnValue({ enrollment, loading: false });
  mockConfirm.mockRejectedValue(new Error('Set up a screen lock'));
  await setup();
  expect(await screen.findByText('Set up a screen lock')).toBeOnTheScreen();
  expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
});

test('re-lock after >60s in background keeps the underlying screen state', async () => {
  mockUseEnrollment.mockReturnValue({ enrollment, loading: false });
  mockConfirm.mockResolvedValue(true);
  const user = userEvent.setup();
  await setup();

  await screen.findByText('count 0');
  expect(screen.queryByTestId('lock-overlay')).toBeNull();
  await user.press(screen.getByText('count 0'));
  await user.press(screen.getByText('count 1'));
  expect(screen.getByText('count 2')).toBeOnTheScreen();

  const now = Date.now();
  const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
  await act(async () => emitAppState('background'));
  expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen(); // app-switcher privacy cover

  mockConfirm.mockResolvedValueOnce(false); // user cancels the re-lock prompt
  spy.mockReturnValue(now + RELOCK_AFTER_MS + 1);
  await act(async () => emitAppState('active'));
  expect(screen.getByText('Locked')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Unlock' }));
  expect(screen.queryByTestId('lock-overlay')).toBeNull();
  // Same component instance survived the lock: its state is intact.
  expect(screen.getByText('count 2')).toBeOnTheScreen();
});

test('a short trip to the background does not re-lock, but hides content while away', async () => {
  mockUseEnrollment.mockReturnValue({ enrollment, loading: false });
  mockConfirm.mockResolvedValue(true);
  await setup();
  await screen.findByText('count 0');

  await act(async () => emitAppState('inactive'));
  expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
  expect(screen.queryByText('Locked')).toBeNull(); // plain cover, no prompt

  await act(async () => emitAppState('background'));
  await act(async () => emitAppState('active'));
  expect(screen.queryByTestId('lock-overlay')).toBeNull();
  expect(mockConfirm).toHaveBeenCalledTimes(1); // only the launch prompt
});
