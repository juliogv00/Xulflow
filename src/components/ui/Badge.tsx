import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "primary" | "success" | "secondary";
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "primary",
  className = "",
}) => {
  const variantClasses = {
    primary: "bg-logo-primary text-white",
    success: "bg-green-600/10 text-green-800",
    secondary: "bg-black/5 text-text/70",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-normal ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
};

export default Badge;
