import { act, render, screen, userEvent } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import Approve from '../app/approve/[id]';
import Enroll from '../app/enroll';
import RecoveryCodes from '../app/recovery-codes';
import { TotpCard } from '../components/TotpCard';
import { ApiError, getChallenge, respondToChallenge, type Challenge } from '../services/api';
import { confirmUserPresence } from '../services/biometrics';
import { enrollWithToken, takeRecoveryCodes } from '../services/enrollment';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: jest.fn(),
}));
jest.mock('../services/api', () => {
  const actual = jest.requireActual('../services/api');
  return { ...actual, getChallenge: jest.fn(), respondToChallenge: jest.fn() };
});
jest.mock('../services/biometrics', () => ({ confirmUserPresence: jest.fn() }));
jest.mock('../services/enrollment', () => {
  const actual = jest.requireActual('../services/enrollment');
  return { ...actual, enrollWithToken: jest.fn(), takeRecoveryCodes: jest.fn() };
});
jest.mock('../components/EnrollmentContext', () => ({ useEnrollment: () => ({ reload: jest.fn(async () => {}) }) }));

// Camera: capture the scan callback so tests can "show" a QR code.
let scan: ((r: { data: string }) => void) | undefined;
jest.mock('expo-camera', () => ({
  useCameraPermissions: jest.fn(),
  CameraView: (props: { onBarcodeScanned?: (r: { data: string }) => void }) => {
    scan = props.onBarcodeScanned;
    return null;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  scan = undefined;
});

/* ------------------------------- Approve ------------------------------- */

const challenge = (over: Partial<Challenge> = {}): Challenge => ({
  id: 'c1',
  nonce: 'n'.repeat(43),
  status: 'PENDING',
  application: 'Payroll',
  requestIp: '203.0.113.7',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 45_000).toISOString(),
  ...over,
});

describe('Approve screen', () => {
  beforeEach(() => (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'c1' }));

  test('shows who is asking and approves only after biometrics', async () => {
    (getChallenge as jest.Mock).mockResolvedValue(challenge());
    (confirmUserPresence as jest.Mock).mockResolvedValue(true);
    (respondToChallenge as jest.Mock).mockResolvedValue({ challengeId: 'c1', status: 'APPROVED' });
    const user = userEvent.setup();
    await render(<Approve />);

    expect(await screen.findByText(/Payroll/)).toBeOnTheScreen();
    expect(screen.getByText(/203\.0\.113\.7/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Approve' }));

    expect(confirmUserPresence).toHaveBeenCalledWith('Approve sign-in');
    expect(respondToChallenge).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), 'APPROVE');
    expect(await screen.findByText('Sign-in approved.')).toBeOnTheScreen();
  });

  test('cancelling biometrics sends nothing', async () => {
    (getChallenge as jest.Mock).mockResolvedValue(challenge());
    (confirmUserPresence as jest.Mock).mockResolvedValue(false);
    const user = userEvent.setup();
    await render(<Approve />);
    await user.press(await screen.findByRole('button', { name: 'Approve' }));
    expect(respondToChallenge).not.toHaveBeenCalled();
  });

  test('deny never waits on biometrics', async () => {
    (getChallenge as jest.Mock).mockResolvedValue(challenge());
    (respondToChallenge as jest.Mock).mockResolvedValue({ challengeId: 'c1', status: 'DENIED' });
    const user = userEvent.setup();
    await render(<Approve />);
    await user.press(await screen.findByRole('button', { name: 'Deny' }));
    expect(confirmUserPresence).not.toHaveBeenCalled();
    expect(respondToChallenge).toHaveBeenCalledWith(expect.anything(), 'DENY');
    expect(await screen.findByText('Sign-in denied.')).toBeOnTheScreen();
  });

  test('expired request hides the buttons', async () => {
    (getChallenge as jest.Mock).mockResolvedValue(challenge({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await render(<Approve />);
    expect(await screen.findByText('This request expired.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  test('already-answered request shows a clear message', async () => {
    (getChallenge as jest.Mock).mockResolvedValue(challenge());
    (respondToChallenge as jest.Mock).mockRejectedValue(new ApiError(409, 'CHALLENGE_CONSUMED', 'x'));
    const user = userEvent.setup();
    await render(<Approve />);
    await user.press(await screen.findByRole('button', { name: 'Deny' }));
    expect(await screen.findByText('This request was already answered.')).toBeOnTheScreen();
  });
});

/* ------------------------------- Enroll ------------------------------- */

describe('Enroll screen', () => {
  const qr = (token: string) => JSON.stringify({ t: 'mrra-enroll', v: 1, token });

  test('asks for camera permission first', async () => {
    const request = jest.fn();
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: false, canAskAgain: true }, request]);
    const user = userEvent.setup();
    await render(<Enroll />);
    await user.press(screen.getByRole('button', { name: 'Allow camera' }));
    expect(request).toHaveBeenCalled();
  });

  test('rejects unrelated QR codes', async () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
    await render(<Enroll />);
    await act(async () => scan!({ data: 'https://example.com/wifi' }));
    expect(screen.getByText('That is not an MR ROKESH enrollment QR code.')).toBeOnTheScreen();
    expect(enrollWithToken).not.toHaveBeenCalled();
  });

  test('valid QR enrolls once and moves to recovery codes', async () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
    (enrollWithToken as jest.Mock).mockResolvedValue({});
    await render(<Enroll />);
    const token = 't'.repeat(43);
    await act(async () => {
      scan!({ data: qr(token) });
      scan?.({ data: qr(token) }); // camera fires repeatedly; must not double-enroll
    });
    expect(enrollWithToken).toHaveBeenCalledTimes(1);
    expect(enrollWithToken).toHaveBeenCalledWith(token);
    expect(router.replace).toHaveBeenCalledWith('/recovery-codes');
  });

  test('used/expired code tells the employee to ask for a new QR', async () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
    (enrollWithToken as jest.Mock).mockRejectedValue(new ApiError(410, 'ENROLL_EXPIRED', 'This enrollment code has expired'));
    await render(<Enroll />);
    await act(async () => scan!({ data: qr('t'.repeat(43)) }));
    expect(await screen.findByText(/expired\. Ask your administrator for a new QR code\./)).toBeOnTheScreen();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

/* ---------------------------- Recovery codes ---------------------------- */

describe('Recovery codes screen', () => {
  test('shows each code once and can copy them', async () => {
    const codes = ['ABCDE-FGHJK', 'LMNPQ-RSTUV'];
    (takeRecoveryCodes as jest.Mock).mockReturnValue(codes);
    const user = userEvent.setup();
    await render(<RecoveryCodes />);
    for (const c of codes) expect(screen.getByText(c)).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Copy codes' }));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('ABCDE-FGHJK\nLMNPQ-RSTUV');

    await user.press(screen.getByRole('button', { name: "I've saved them" }));
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  test('without fresh codes it explains they were shown once', async () => {
    (takeRecoveryCodes as jest.Mock).mockReturnValue(null);
    await render(<RecoveryCodes />);
    expect(screen.getByText(/only shown once/)).toBeOnTheScreen();
  });
});

/* ------------------------------- TOTP card ------------------------------- */

describe('TotpCard', () => {
  afterEach(() => jest.useRealTimers());

  test('renders the RFC 6238 code for the current time and counts down', async () => {
    jest.useFakeTimers({ now: 1111111109 * 1000 });
    await render(
      <TotpCard
        totp={{ secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', issuer: 'MR ROKESH', accountName: 'alice@example.test', algorithm: 'SHA1', digits: 6, period: 30 }}
      />,
    );
    expect(screen.getByText('081 804')).toBeOnTheScreen();
    expect(screen.getByText(/Refreshes in 1s/)).toBeOnTheScreen();

    await act(async () => jest.advanceTimersByTime(1000)); // crosses into the next 30s step
    expect(screen.queryByText('081 804')).toBeNull();
    expect(screen.getByText(/Refreshes in 30s/)).toBeOnTheScreen();
  });
});
