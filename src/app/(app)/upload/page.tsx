import type { Metadata } from "next";
import { UploadFlow } from "@/components/upload/upload-flow";

export const metadata: Metadata = {
  title: "Upload a statement — fin.",
};

export default function UploadPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Upload</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          A bank or bKash statement PDF. If it is password-protected, you will
          be asked for the password — it is used once and never stored.
        </p>
      </header>

      <UploadFlow />
    </div>
  );
}
