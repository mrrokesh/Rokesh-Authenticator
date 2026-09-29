import { AppState, Linking, type AppStateStatus } from 'react-native';
import { act, render, screen, userEvent } from '@testing-library/react-native';
import { PushSettingsCard } from '../components/PushSettingsCard';
import { getPushPermission, registerForPush } from '../services/push';
import { getDeviceInfo, updatePushToken } from '../services/api';

jest.mock('../services/push', () => ({ getPushPermission: jest.fn(), registerForPush: jest.fn() }));
jest.mock('../services/api', () => ({ getDeviceInfo: jest.fn(), updatePushToken: jest.fn() }));

const perm = getPushPermission as jest.Mock;
const register = registerForPush as jest.Mock;
const deviceInfo = getDeviceInfo as jest.Mock;
const upload = updatePushToken as jest.Mock;

let listeners: Array<(s: AppStateStatus) => void> = [];
beforeEach(() => {
  jest.clearAllMocks();
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => {
    listeners.push(cb as (s: AppStateStatus) => void);
    return { remove: jest.fn() } as never;
  });
  upload.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

const server = (pushRegistered: boolean) => deviceInfo.mockResolvedValue({ pushRegistered });

test('off but askable → "Turn on notifications" asks, registers with the server, then shows On', async () => {
  perm.mockResolvedValue({ supported: true, granted: false, canAskAgain: true });
  server(false);
  // The OS prompt: the employee taps "Allow".
  register.mockImplementation(async () => {
    perm.mockResolvedValue({ supported: true, granted: true, canAskAgain: true });
    server(true);
    return { pushToken: 'fcm-abc', pushPlatform: 'fcm' };
  });
  const user = userEvent.setup();
  await render(<PushSettingsCard />);

  await user.press(await screen.findByRole('button', { name: 'Turn on notifications' }));

  expect(register).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledWith('fcm-abc', 'fcm');
  expect(await screen.findByText(/^On\./)).toBeOnTheScreen();
  expect(screen.queryByRole('button')).toBeNull();
});

test('permanently denied → offers the OS settings app', async () => {
  perm.mockResolvedValue({ supported: true, granted: false, canAskAgain: false });
  server(false);
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  const user = userEvent.setup();
  await render(<PushSettingsCard />);

  expect(await screen.findByText(/Blocked in your phone’s settings/)).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Open phone settings' }));
  expect(openSettings).toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
});

test('returning from OS settings with permission now granted registers automatically', async () => {
  perm.mockResolvedValue({ supported: true, granted: false, canAskAgain: false });
  server(false);
  await render(<PushSettingsCard />);
  await screen.findByText(/Blocked/);

  perm.mockResolvedValue({ supported: true, granted: true, canAskAgain: false });
  register.mockResolvedValue({ pushToken: 'apns-xyz', pushPlatform: 'apns' });
  deviceInfo.mockResolvedValueOnce({ pushRegistered: false }).mockResolvedValue({ pushRegistered: true });
  await act(async () => listeners.forEach((l) => l('active')));

  expect(await screen.findByText(/^On\./)).toBeOnTheScreen();
  expect(upload).toHaveBeenCalledWith('apns-xyz', 'apns');
});

test('emulators are told push is unsupported, with no action', async () => {
  perm.mockResolvedValue({ supported: false, granted: false, canAskAgain: false });
  server(false);
  await render(<PushSettingsCard />);
  expect(await screen.findByText(/can’t receive push notifications/)).toBeOnTheScreen();
  expect(screen.queryByRole('button')).toBeNull();
});

test('server unreachable → Retry', async () => {
  perm.mockResolvedValue({ supported: true, granted: true, canAskAgain: true });
  deviceInfo.mockRejectedValue(new Error('offline'));
  await render(<PushSettingsCard />);
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeOnTheScreen();
});
