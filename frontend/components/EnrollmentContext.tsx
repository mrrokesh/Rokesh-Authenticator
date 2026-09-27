import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearAll, loadEnrollment, type Enrollment } from '../services/storage';

interface EnrollmentState {
  enrollment: Enrollment | null;
  loading: boolean;
  reload: () => Promise<void>;
  reset: () => Promise<void>;
}

const Ctx = createContext<EnrollmentState | null>(null);

export function EnrollmentProvider({ children }: { children: ReactNode }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setEnrollment(await loadEnrollment());
    setLoading(false);
  }, []);

  const reset = useCallback(async () => {
    await clearAll();
    setEnrollment(null);
  }, []);

  useEffect(() => {
    loadEnrollment()
      .then(setEnrollment)
      .catch(() => setEnrollment(null)) // unreadable keystore → treat as not enrolled
      .finally(() => setLoading(false));
  }, []);

  return <Ctx.Provider value={{ enrollment, loading, reload, reset }}>{children}</Ctx.Provider>;
}

export function useEnrollment() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEnrollment must be used inside EnrollmentProvider');
  return ctx;
}
