"use client";

import { useActionState, useState } from "react";
import { shareExpenseAction } from "@/server/actions/shared";
import { initialFormState } from "@/lib/form-state";
import { type Member, SplitEditor, emptySplit, splitPayload, splitPreview } from "@/components/split-editor";
import { StickyAction } from "@/components/sticky-action";
import { Alert, Button } from "@/components/ui";

export function ShareForm({ txId, total, members }: { txId: string; total: number; members: Member[] }) {
  const [split, setSplit] = useState(emptySplit);
  const [state, action, pending] = useActionState(shareExpenseAction.bind(null, txId), initialFormState);
  const preview = splitPreview(total, split);
  const error = state.message ?? (state.fieldErrors ? Object.values(state.fieldErrors).flat().filter(Boolean)[0] : undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="shared" value={splitPayload(split)} />
      {error && <Alert>{error}</Alert>}
      <SplitEditor members={members} total={total} value={split} onChange={setSplit} />
      <StickyAction>
        <Button type="submit" disabled={pending || !preview?.ok}>
          {pending ? "Guardando…" : "Compartir gasto"}
        </Button>
      </StickyAction>
    </form>
  );
}
