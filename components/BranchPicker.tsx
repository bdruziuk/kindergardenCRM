"use client";
import { useEffect, useState } from "react";
import type { ScopeDto } from "@/lib/api-schemas";

const STORAGE_KEY = "malecha:branch";

/**
 * Holds the branch the viewer is looking at.
 *
 * `query` is what pages append to their API calls: an empty string while
 * there is nothing to choose, so a single-branch kindergarten never carries a
 * branch parameter around. The choice is remembered per browser, because an
 * owner switching branches expects the next page to stay where they were.
 */
export function useBranch() {
  const [scope, setScope] = useState<ScopeDto | null>(null);
  const [branchId, setBranchId] = useState<number | null>(null);

  useEffect(() => {
    const remembered =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(STORAGE_KEY);
    const suffix = remembered ? `?branch=${remembered}` : "";

    fetch("/api/scope" + suffix)
      .then((response) => response.json())
      .then((next: ScopeDto) => {
        if (next.error) return;
        setScope(next);
        setBranchId(next.branchId);
      })
      // A failure here leaves the picker hidden; the pages surface their own
      // errors, so there is no second message to add.
      .catch(() => {});
  }, []);

  const choose = (id: number) => {
    setBranchId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      // private mode or blocked storage — the choice just will not persist
    }
  };

  return {
    scope,
    branchId,
    choose,
    // Derived from the current choice, not from the scope fetched on mount —
    // otherwise captions keep naming the branch the page opened with.
    branchName:
      scope?.branches.find((branch) => branch.id === branchId)?.name ??
      scope?.branchName ??
      "",
    /** Append to API urls; empty unless a branch actually has to be named. */
    branchQuery: scope?.canSwitch && branchId ? `&branch=${branchId}` : "",
  };
}

export function BranchPicker({
  scope,
  branchId,
  onChange,
}: {
  scope: ScopeDto | null;
  branchId: number | null;
  onChange: (id: number) => void;
}) {
  // Nothing to pick: one branch, run by the owner alone.
  if (!scope?.canSwitch) return null;

  if (!scope.isOwner)
    return (
      <label>
        <small>Філія</small>
        <select value={scope.branchId} disabled>
          <option>{scope.branchName}</option>
        </select>
      </label>
    );

  return (
    <label>
      <small>Філія</small>
      <select
        value={branchId ?? scope.branchId}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {scope.branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </label>
  );
}
