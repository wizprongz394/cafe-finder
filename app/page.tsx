"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const auth = localStorage.getItem("expresso_auth");
    if (auth === "true") {
      router.push("/main");
    } else {
      router.push("/splash");
    }
  }, [router]);

  return (
    <div className="h-screen bg-[#FFECD1] flex items-center justify-center">
      <div className="text-[#3E000C] font-['DM_Sans'] text-sm tracking-wider">Loading Expresso...</div>
    </div>
  );
}