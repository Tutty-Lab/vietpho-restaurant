import type { VietphoOwnerSegment } from "../lib/vietphoDemand";
import { minutesToTime } from "../lib/time";

export function OwnerTimes({ segments }: { segments: VietphoOwnerSegment[] }) {
  return <>{segments.map((s) => (
    <div key={s.startMinutes} className="whitespace-nowrap">
      {s.role === "SERVICE" ? "Bồi" : "Bếp"} {minutesToTime(s.startMinutes)}–{minutesToTime(s.endMinutes)}
    </div>
  ))}</>;
}
