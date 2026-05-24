"use client";

interface ClassIconProps {
  className: string;
  iconUrl?: string;
  size?: number;
}

export function ClassIcon({ className, iconUrl, size = 18 }: ClassIconProps) {
  if (!iconUrl) return null;
  return (
    <img
      src={iconUrl}
      alt={className}
      width={size}
      height={size}
      className="inline-block rounded-sm shrink-0"
      style={{ imageRendering: "auto" }}
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
