import './Button.scss';

interface ButtonProps {
  label: string;
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
}

export function Button({ label, variant = 'primary', onClick }: ButtonProps) {
  return (
    <button className={`button button--${variant}`} onClick={onClick}>
      {label}
    </button>
  );
}
