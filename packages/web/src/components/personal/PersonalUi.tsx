import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import DialogCard from "../ui/DialogCard";
import { usePersonalStrings } from "./usePersonalStrings";
export function PersonalButton({
  primary,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      className={`pw-button${primary ? " pw-primary" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function PersonalDialog(props: ComponentProps<typeof DialogCard>) {
  return <DialogCard {...props} trapFocus />;
}
export function PersonalEmpty({
  icon,
  title,
  description,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="pw-empty">
      {icon}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function PersonalErrorNotice({ onRetry }: { onRetry?: () => void }) {
  const t = usePersonalStrings();
  return (
    <div className="pw-notice" role="alert">
      {t("error")}
      {onRetry && (
        <PersonalButton onClick={onRetry}>{t("retry")}</PersonalButton>
      )}
    </div>
  );
}
