"use client";

import { createContext, useContext, useMemo, useState } from "react";

type ReplayTimelineContextValue = {
  replayDays: number;
  setReplayDays: (days: number) => void;
  isControlled: boolean;
};

const ReplayTimelineContext = createContext<ReplayTimelineContextValue>({
  replayDays: 0,
  setReplayDays: () => {},
  isControlled: false,
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ReplayTimelineProvider({
  children,
  initialDays = 0,
}: {
  children: React.ReactNode;
  initialDays?: number;
}) {
  const [replayDays, setReplayDaysState] = useState<number>(clamp(initialDays, 0, 365));

  const value = useMemo<ReplayTimelineContextValue>(
    () => ({
      replayDays,
      setReplayDays: (days: number) => setReplayDaysState(clamp(Number(days) || 0, 0, 365)),
      isControlled: true,
    }),
    [replayDays],
  );

  return <ReplayTimelineContext.Provider value={value}>{children}</ReplayTimelineContext.Provider>;
}

export function useReplayTimeline(): ReplayTimelineContextValue {
  return useContext(ReplayTimelineContext);
}
