'use client';

import { useState, useTransition, type FormEvent } from 'react';
import {
  searchAvailableNumbers,
  provisionPhoneNumber,
  type AvailableNumber,
  type ProvisionedNumber,
} from '@/lib/receptionist/phone-provisioner';

type WizardStep = 'area-code' | 'select-number' | 'provisioning' | 'success' | 'error';

const container: React.CSSProperties = {
  maxWidth: 560,
  margin: '0 auto',
  padding: '3rem 1.5rem',
  fontFamily: 'inherit',
};

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: '2rem',
  background: '#fff',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};

const heading: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 700,
  marginBottom: '0.5rem',
  color: '#111',
};

const subheading: React.CSSProperties = {
  fontSize: '0.9rem',
  color: '#6b7280',
  marginBottom: '1.5rem',
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: '0.85rem',
  fontWeight: 600,
  marginBottom: '0.4rem',
  color: '#374151',
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: '1rem',
  outline: 'none',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  marginTop: '1rem',
  width: '100%',
  padding: '0.7rem 1rem',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: '1rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  marginTop: '0.6rem',
  width: '100%',
  padding: '0.7rem 1rem',
  background: '#f3f4f6',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: '0.95rem',
  fontWeight: 500,
  cursor: 'pointer',
};

const errorBox: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.6rem 0.8rem',
  background: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: 6,
  color: '#dc2626',
  fontSize: '0.85rem',
};

const successIcon: React.CSSProperties = {
  fontSize: '3rem',
  marginBottom: '1rem',
  display: 'block',
  textAlign: 'center',
};

const phoneDisplay: React.CSSProperties = {
  fontSize: '1.6rem',
  fontWeight: 700,
  textAlign: 'center',
  color: '#111',
  letterSpacing: '0.05em',
  margin: '0.75rem 0',
};

const stepIndicator: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#9ca3af',
  marginBottom: '1.25rem',
};

export default function OnboardPage(): JSX.Element {
  const [step, setStep] = useState<WizardStep>('area-code');
  const [areaCode, setAreaCode] = useState('');
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<string>('');
  const [provisionedNumber, setProvisionedNumber] = useState<ProvisionedNumber | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchError, setSearchError] = useState('');
  const [isPending, startTransition] = useTransition();

  async function getContractorId(): Promise<string> {
    try {
      const resp = await fetch('/api/auth/session');
      if (resp.ok) {
        const session = await resp.json();
        if (session?.user?.id) return String(session.user.id);
        if (session?.user?.email) return String(session.user.email);
      }
    } catch {
      // fallback below
    }
    return `onboard-${Date.now()}`;
  }

  function handleAreaCodeSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setSearchError('');
    startTransition(async () => {
      const result = await searchAvailableNumbers(areaCode.trim());
      if (result.error) {
        setSearchError(result.error);
        return;
      }
      if (result.numbers.length === 0) {
        setSearchError(
          `No numbers available for area code ${areaCode}. Try a different area code.`,
        );
        return;
      }
      setAvailableNumbers(result.numbers);
      setSelectedNumber(result.numbers[0].phoneNumber);
      setStep('select-number');
    });
  }

  function handleProvision(): void {
    if (!selectedNumber) return;
    setStep('provisioning');
    startTransition(async () => {
      const contractorId = await getContractorId();
      const result = await provisionPhoneNumber(selectedNumber, contractorId);
      if (!result.success || !result.number) {
        setErrorMessage(result.error ?? 'Provisioning failed. Please try again.');
        setStep('error');
        return;
      }
      setProvisionedNumber(result.number);
      setStep('success');
    });
  }

  function formatPhoneNumber(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      const area = digits.slice(1, 4);
      const prefix = digits.slice(4, 7);
      const line = digits.slice(7);
      return `+1 (${area}) ${prefix}-${line}`;
    }
    return raw;
  }

  if (step === 'area-code') {
    return (
      <div style={container}>
        <div style={card}>
          <span style={stepIndicator}>Step 1 of 3</span>
          <h1 style={heading}>Set up your receptionist number</h1>
          <p style={subheading}>
            We'll find a local number matching your area code and configure it to forward calls to
            your AI receptionist.
          </p>
          <form onSubmit={handleAreaCodeSubmit}>
            <label style={label} htmlFor="area-code-input">
              Your business area code
            </label>
            <input
              id="area-code-input"
              type="text"
              inputMode="numeric"
              maxLength={3}
              placeholder="e.g. 415"
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ''))}
              style={input}
              required
              disabled={isPending}
            />
            {searchError && <div style={errorBox}>{searchError}</div>}
            <button type="submit" style={btnPrimary} disabled={isPending || areaCode.length !== 3}>
              {isPending ? 'Searching…' : 'Search Available Numbers'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (step === 'select-number') {
    return (
      <div style={container}>
        <div style={card}>
          <span style={stepIndicator}>Step 2 of 3</span>
          <h1 style={heading}>Choose your number</h1>
          <p style={subheading}>
            Select a local number for your AI receptionist. All inbound calls will be forwarded
            automatically.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {availableNumbers.map((num) => (
              <label
                key={num.phoneNumber}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem',
                  border: `2px solid ${selectedNumber === num.phoneNumber ? '#2563eb' : '#e5e7eb'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: selectedNumber === num.phoneNumber ? '#eff6ff' : '#fff',
                  transition: 'border-color 0.15s',
                }}
              >
                <input
                  type="radio"
                  name="phone-number"
                  value={num.phoneNumber}
                  checked={selectedNumber === num.phoneNumber}
                  onChange={() => setSelectedNumber(num.phoneNumber)}
                  style={{ accentColor: '#2563eb' }}
                />
                <span>
                  <strong style={{ fontSize: '1rem' }}>{formatPhoneNumber(num.phoneNumber)}</strong>
                  {(num.locality || num.region) && (
                    <span style={{ fontSize: '0.8rem', color: '#6b7280', marginLeft: '0.5rem' }}>
                      {[num.locality, num.region].filter(Boolean).join(', ')}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            style={btnPrimary}
            onClick={handleProvision}
            disabled={!selectedNumber || isPending}
          >
            {isPending ? 'Provisioning…' : 'Provision This Number'}
          </button>
          <button
            type="button"
            style={btnSecondary}
            onClick={() => setStep('area-code')}
            disabled={isPending}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (step === 'provisioning') {
    return (
      <div style={container}>
        <div style={{ ...card, textAlign: 'center' }}>
          <span style={{ ...successIcon, fontSize: '2.5rem' }}>⚙️</span>
          <h1 style={heading}>Provisioning your number…</h1>
          <p style={subheading}>
            Purchasing{' '}
            <strong>{formatPhoneNumber(selectedNumber)}</strong> and configuring call
            forwarding. This takes a few seconds.
          </p>
          <div
            style={{
              width: 40,
              height: 40,
              border: '4px solid #e5e7eb',
              borderTopColor: '#2563eb',
              borderRadius: '50%',
              margin: '1.5rem auto 0',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (step === 'success' && provisionedNumber) {
    return (
      <div style={container}>
        <div style={{ ...card, textAlign: 'center' }}>
          <span style={successIcon}>✅</span>
          <h1 style={heading}>Your receptionist number is ready!</h1>
          <p style={subheading}>
            This number will forward all inbound calls to your AI receptionist.
          </p>
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: 10,
              padding: '1.25rem',
              margin: '1.25rem 0',
            }}
          >
            <div style={phoneDisplay}>{formatPhoneNumber(provisionedNumber.phoneNumber)}</div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
              SID: {provisionedNumber.sid}
            </div>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#374151', marginBottom: '1rem' }}>
            Your number is live. Callers will hear your AI receptionist immediately. Number
            reputation is monitored automatically — if spam labels appear, your number will be
            replaced with a clean local number.
          </p>
          <a href="/" style={{ ...btnPrimary, display: 'block', textDecoration: 'none' }}>
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div style={container}>
        <div style={{ ...card, textAlign: 'center' }}>
          <span style={{ ...successIcon, fontSize: '2.5rem' }}>❌</span>
          <h1 style={heading}>Provisioning failed</h1>
          <div style={{ ...errorBox, textAlign: 'left', marginBottom: '1rem' }}>
            {errorMessage}
          </div>
          <button
            type="button"
            style={btnPrimary}
            onClick={() => {
              setErrorMessage('');
              setStep('select-number');
            }}
          >
            Try Again
          </button>
          <button
            type="button"
            style={btnSecondary}
            onClick={() => {
              setAreaCode('');
              setAvailableNumbers([]);
              setSelectedNumber('');
              setErrorMessage('');
              setStep('area-code');
            }}
          >
            Start Over
          </button>
        </div>
      </div>
    );
  }

  return <div style={container} />;
}
