"use client";

import { usePathname } from "next/navigation";
import FloatingChatWidget from "@/components/chat/FloatingChatWidget";

export default function FloatingChatGate() {
  const pathname = usePathname();

  if (!pathname) {
    return null;
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return null;
  }

  return <FloatingChatWidget />;
}