type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
};

export function Button({ className = "", variant = "primary", ...props }: ButtonProps) {
  const styles = {
    primary: "border border-transparent bg-accent text-white shadow-glow hover:brightness-105",
    secondary: "border border-line bg-surface text-ink shadow-sm hover:border-strong hover:bg-subtle",
    danger: "border border-transparent bg-red-700 text-white shadow-sm hover:bg-red-800"
  };
  return (
    <button
      className={`inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
