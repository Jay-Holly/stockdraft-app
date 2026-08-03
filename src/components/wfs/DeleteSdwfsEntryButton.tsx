"use client";

import { useState } from "react";

export function DeleteSdwfsEntryButton({ entryId }: { entryId: string }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!confirm("Delete your entry? Your buy-in will be refunded to your wallet.")) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch("/api/sdwfs/delete-entry", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete entry");
      }

      // Reload page to reflect changes
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete entry");
      setIsDeleting(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleDelete}
        disabled={isDeleting}
        className="text-sm text-gold font-semibold hover:underline disabled:opacity-50"
      >
        {isDeleting ? "Deleting..." : "Delete my entry in this contest"}
      </button>
      {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
    </div>
  );
}
