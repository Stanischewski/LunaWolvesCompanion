"use client";

import { useState } from "react";

export function DungeonImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) return <div className="absolute inset-0 bg-zinc-800" />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="absolute inset-0 w-full h-full object-cover opacity-30"
    />
  );
}
