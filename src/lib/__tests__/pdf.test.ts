import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadPdfBlob, safeFileName } from "../pdf";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("safeFileName", () => {
  it("entfernt vietnamesische Akzente", () => {
    expect(safeFileName("Nguyễn Văn Tuấn")).toBe("Nguyen_Van_Tuan");
    expect(safeFileName("Đức")).toBe("Duc");
  });

  it("entfernt deutsche Umlaute und ß-fremde Zeichen", () => {
    expect(safeFileName("Jörg Müller")).toBe("Jorg_Muller");
  });

  it("lässt unbedenkliche Zeichen stehen", () => {
    expect(safeFileName("Mai-2026_08")).toBe("Mai-2026_08");
  });

  it("hat immer einen brauchbaren Rückfallwert", () => {
    expect(safeFileName("   ")).toBe("Stundenzettel");
    expect(safeFileName("///")).toBe("Stundenzettel");
  });
});

describe("downloadPdfBlob", () => {
  it("downloads directly without opening the native share sheet", () => {
    vi.useFakeTimers();
    const anchor = { href: "", download: "", rel: "", style: {}, click: vi.fn() };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const share = vi.fn();
    const createObjectURL = vi.fn(() => "blob:pdf");
    const revokeObjectURL = vi.fn();

    vi.stubGlobal("navigator", { canShare: () => true, share });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor),
      body: { appendChild, removeChild, contains: vi.fn(() => true) },
    });

    downloadPdfBlob(new Blob(["pdf"], { type: "application/pdf" }), "test.pdf");

    expect(share).not.toHaveBeenCalled();
    expect(anchor.href).toBe("blob:pdf");
    expect(anchor.download).toBe("test.pdf");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    // Anker und Objekt-URL werden erst nach dem Timer aufgeräumt – iOS lädt
    // sonst noch, während der Link schon entfernt ist.
    vi.runAllTimers();
    expect(removeChild).toHaveBeenCalledWith(anchor);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pdf");
  });
});

describe("Stundenzettel: ca gãy", () => {
  it("prints each piece of a split shift on its own line with its own hours", async () => {
    const { stundenzettelRowsFor } = await import("../pdf");
    const schedule = {
      year: 2026, month: 9, holidayState: "BW", dateOverrides: [],
      shifts: [
        {
          id: "s1", employeeId: "e1", date: "2026-09-02", startMinutes: 11 * 60, endMinutes: 20 * 60,
          pauseMinutes: 0, paidMinutes: 7 * 60, shiftType: "CUSTOM", generated: true,
          segments: [
            { startMinutes: 11 * 60, endMinutes: 15 * 60 },
            { startMinutes: 17 * 60, endMinutes: 20 * 60 },
          ],
        },
        {
          id: "s2", employeeId: "e1", date: "2026-09-03", startMinutes: 11 * 60, endMinutes: 18 * 60,
          pauseMinutes: 30, paidMinutes: 6.5 * 60, shiftType: "CUSTOM", generated: true,
        },
      ],
    } as never;
    const employee = { id: "e1", name: "E", employmentType: "VOLLZEIT", targetMinutes: 0 } as never;
    const { rows, totalMinutes } = stundenzettelRowsFor(schedule, employee, ["2026-09-02", "2026-09-03"]);
    // [datum, beginn, ende, pause, arbeitszeit, bemerkung]
    expect(rows[0].cells.slice(1, 5)).toEqual(["11:00\n17:00", "15:00\n20:00", "\n", "4,00\n3,00"]);
    expect(rows[0].shiftCount).toBe(2);
    expect(rows[1].cells.slice(1, 5)).toEqual(["11:00", "18:00", "30 Min", "6,50"]);
    expect(totalMinutes).toBe(13.5 * 60);
  });
});

describe("Stundenzettel-PDF", () => {
  it("starts with the Stundenübersicht page, then one page per employee", async () => {
    const { buildStundenzettelPdf } = await import("../pdf");
    const { createSampleSchedule } = await import("../sampleData");
    const schedule = createSampleSchedule();
    const employees = schedule.employees.slice(0, 2);
    const doc = await buildStundenzettelPdf(schedule, employees);
    expect(doc.getNumberOfPages()).toBe(employees.length + 1);
  });
});
