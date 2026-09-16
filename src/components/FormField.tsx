import type { ReactNode } from 'react';
import { Icon } from './Icon';
import './FormField.css';

export interface FieldControlProps {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
}

interface FormFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/** 라벨·도움말·오류 문구를 입력 요소와 연결한다. */
export function FormField({ id, label, hint, error, children }: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`form-field${error ? ' form-field--invalid' : ''}`}>
      <label htmlFor={id} className="form-field__label">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="form-field__hint">
          {hint}
        </p>
      ) : null}
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={errorId} className="form-field__error">
          <Icon name="error" size="sm" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
