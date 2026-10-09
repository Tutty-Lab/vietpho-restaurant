import { WEEKDAY_LABELS_VI, type WeekdayKey } from "../lib/demand";
import {
  THIENLONG_REFERENCE_INVOICES,
  thienlongDemandShares,
  thienlongDemandWeight,
  thienlongLateShiftRatio,
  thienlongRoleShare,
} from "../lib/thienlongDemand";
import {
  VIETPHO_REFERENCE_INVOICES,
  vietphoDemandWeight,
  vietphoLateShiftRatio,
} from "../lib/vietphoDemand";

const WEEKDAY_ORDER: WeekdayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const THIENLONG_DAY_WEIGHTS = Object.fromEntries(
  WEEKDAY_ORDER.map((weekday) => [weekday, thienlongDemandWeight(weekday)]),
) as Record<WeekdayKey, number>;

const THIENLONG_LATE_SHIFT_RATIOS = Object.fromEntries(
  WEEKDAY_ORDER.map((weekday) => [weekday, thienlongLateShiftRatio(weekday)]),
) as Record<WeekdayKey, number>;

const VIETPHO_DAY_WEIGHTS = Object.fromEntries(
  WEEKDAY_ORDER.map((weekday) => [weekday, vietphoDemandWeight(weekday)]),
) as Record<WeekdayKey, number>;

const VIETPHO_LATE_SHIFT_RATIOS = Object.fromEntries(
  WEEKDAY_ORDER.map((weekday) => [weekday, vietphoLateShiftRatio(weekday)]),
) as Record<WeekdayKey, number>;

function roleRatio(kitchenShare: number, serviceShare: number): string {
  const total = kitchenShare + serviceShare;
  return `${((kitchenShare / total) * 100).toFixed(1).replace(".", ",")}% / ${(
    (serviceShare / total) *
    100
  )
    .toFixed(1)
    .replace(".", ",")}%`;
}

function demandShareBetween(
  weekday: WeekdayKey,
  role: "KITCHEN" | "SERVICE",
  startMinutes: number,
  endMinutes: number,
): number {
  return thienlongDemandShares(weekday, role).reduce((total, demand) => {
    const overlap = Math.max(
      0,
      Math.min(endMinutes, demand.endMinutes) - Math.max(startMinutes, demand.startMinutes),
    );
    const duration = demand.endMinutes - demand.startMinutes;
    return total + (duration > 0 ? (demand.share * overlap) / duration : 0);
  }, 0);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900 mb-2">{title}</h2>
      <div className="text-sm text-slate-700 space-y-2 leading-relaxed">{children}</div>
    </section>
  );
}

/** Bảng hằng số theo thứ (đọc trực tiếp từ code nên luôn khớp). */
function WeekdayTable({
  values,
  format,
  highlight,
}: {
  values: Record<WeekdayKey, number>;
  format: (v: number) => string;
  highlight: (key: WeekdayKey) => boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-collapse">
        <thead>
          <tr>
            {WEEKDAY_ORDER.map((k) => (
              <th
                key={k}
                className={`border border-slate-200 px-3 py-1 font-medium ${
                  highlight(k) ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-600"
                }`}
              >
                {WEEKDAY_LABELS_VI[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {WEEKDAY_ORDER.map((k) => (
              <td
                key={k}
                className={`border border-slate-200 px-3 py-1 text-center font-semibold ${
                  highlight(k) ? "bg-indigo-50 text-indigo-900" : ""
                }`}
              >
                {format(values[k])}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function DocsTab({ storeId }: { storeId: string }) {
  const isThienlong = storeId === "thienlong";
  const dayWeights = isThienlong ? THIENLONG_DAY_WEIGHTS : VIETPHO_DAY_WEIGHTS;
  const lateShiftRatios = isThienlong
    ? THIENLONG_LATE_SHIFT_RATIOS
    : VIETPHO_LATE_SHIFT_RATIOS;
  const weekdayKitchen = thienlongRoleShare("monday", "KITCHEN");
  const weekdayService = thienlongRoleShare("monday", "SERVICE");
  const weekdayLunchKitchen = demandShareBetween("monday", "KITCHEN", 10 * 60 + 30, 15 * 60);
  const weekdayLunchService = demandShareBetween("monday", "SERVICE", 10 * 60 + 30, 15 * 60);
  const weekdayEveningKitchen = demandShareBetween("monday", "KITCHEN", 16 * 60 + 30, 22 * 60);
  const weekdayEveningService = demandShareBetween("monday", "SERVICE", 16 * 60 + 30, 22 * 60);
  const fridayKitchen = thienlongRoleShare("friday", "KITCHEN");
  const fridayService = thienlongRoleShare("friday", "SERVICE");
  const saturdayKitchen = thienlongRoleShare("saturday", "KITCHEN");
  const saturdayService = thienlongRoleShare("saturday", "SERVICE");
  const sundayKitchen = thienlongRoleShare("sunday", "KITCHEN");
  const sundayService = thienlongRoleShare("sunday", "SERVICE");

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-lg bg-slate-900 text-white p-4 sm:p-5">
        <h1 className="text-lg font-semibold">Tài liệu — cách xếp lịch hoạt động</h1>
        <p className="text-sm text-slate-300 mt-1">
          {isThienlong
            ? "Thienlong dùng tỷ lệ Bếp/Bồi từ lịch thực tế mẫu và tự co giãn theo tổng giờ tháng."
            : "Vietpho dùng profile riêng: ca ngắn hơn, không tách Bếp/Bồi và ưu tiên hai giờ cao điểm."}
        </p>
      </div>

      {isThienlong && (
        <Section title="Thienlong: tỷ lệ Bếp / Bồi từ lịch thực tế mẫu">
          <p>
            Lịch thực tế khách cung cấp chỉ dùng để suy ra <b>tỷ lệ phần trăm</b> Bếp/Bồi và
            tỷ trọng theo khung giờ. Các số giờ mẫu <b>không phải định mức cố định</b>. Mốc tham
            chiếu là <b>{THIENLONG_REFERENCE_INVOICES} Rechnungen</b>.
          </p>
          <p>
            Tổng giờ của ngày vẫn được tính từ tổng giờ nhân viên và hệ số ngày; sau đó thuật toán
            dùng các tỷ lệ bên dưới làm <b>mục tiêu mềm</b>. Kết quả có thể lệch nhẹ để giữ đúng
            định mức tháng, độ dài ca và các quy tắc nghỉ.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="border border-slate-200 px-3 py-2 text-left">Nhóm ngày</th>
                  <th className="border border-slate-200 px-3 py-2 text-right">Tỉ lệ Bếp / Bồi</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-200 px-3 py-2">Thứ 2-5 · trưa</td>
                  <td className="border border-slate-200 px-3 py-2 text-right font-medium">
                    {roleRatio(weekdayLunchKitchen, weekdayLunchService)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-200 px-3 py-2">Thứ 2-5 · tối</td>
                  <td className="border border-slate-200 px-3 py-2 text-right font-medium">
                    {roleRatio(weekdayEveningKitchen, weekdayEveningService)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-200 px-3 py-2">Thứ 2-5 · cả ngày</td>
                  <td className="border border-slate-200 px-3 py-2 text-right font-medium">
                    {roleRatio(weekdayKitchen, weekdayService)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-200 px-3 py-2">Thứ 6</td>
                  <td className="border border-slate-200 px-3 py-2 text-right font-medium">
                    {roleRatio(fridayKitchen, fridayService)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-200 px-3 py-2">Thứ 7 / lễ</td>
                  <td className="border border-slate-200 px-3 py-2 text-right font-medium">
                    {roleRatio(saturdayKitchen, saturdayService)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-200 px-3 py-2">Chủ Nhật</td>
                  <td className="border border-slate-200 px-3 py-2 text-right font-medium">
                    {roleRatio(sundayKitchen, sundayService)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-slate-600">
            Giờ cao điểm tối: <b>Thứ 2–5 18:00–20:30</b>, <b>Thứ 6, 7, Chủ Nhật (và ngày lễ)
            18:00–21:00</b>. 17:00–18:00 chỉ là giờ khách bắt đầu vào, nên ca tối thường bắt
            đầu 18:00 chứ không phải 17:00. Buổi trưa ưu tiên 12:00–14:00. Đây là{" "}
            <b>tỷ trọng ưu tiên</b>, không
            bắt buộc cố định 3-4 người Bếp hay 2 người Bồi. Ca tối 16:30-22:00 được giữ
            đúng <b>5,5h</b> để lắp vừa khung.
            T6 và T7 là hai ngày đông nhất; Chủ Nhật chỉ nhỉnh hơn T2-T5. Tổng số người
            thực tế vẫn phụ thuộc tổng giờ có thể phân bổ trong ngày đó.
          </p>
        </Section>
      )}

      {!isThienlong && (
        <Section title="Vietpho: Chủ quán làm mỗi ngày, ưu tiên Bồi">
          <p>
            Mốc tham chiếu của Vietpho là <b>{VIETPHO_REFERENCE_INVOICES} Rechnungen inkl. Steuer</b>.
            Chủ quán làm toàn bộ giờ mở cửa mỗi ngày, ưu tiên Bồi. Nhân viên được ưu tiên lấp ca Bếp; chủ phụ Bếp khi thiếu bếp và đã có người làm Bồi.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Chủ nghỉ khi quán đóng cửa; giờ chủ không cộng vào định mức nhân viên.</li>
            <li>Nhân viên bắt đầu đúng giờ mở cửa, không đến sớm 30 phút.</li>
            <li>Ca ngắn hơn Thienlong khoảng 1–2 giờ, tối đa <b>8h/ca</b>.</li>
            <li>Luôn ưu tiên ít nhất <b>2 người lúc 12:30–13:00 và 18:00–20:00</b>.</li>
            <li>Bồi được ưu tiên vào <b>12:00–14:00</b> và <b>18:00–20:00</b>; có thể xếp 2 ca trong một ngày.</li>
            <li>T6/T7 chỉ cao hơn ngày thường khoảng <b>20%</b>; Chủ Nhật nhỉnh hơn nhẹ.</li>
          </ul>
        </Section>
      )}

      <Section title="Luật riêng từng người (mềm)">
        <p>
          Trong form nhân viên, mục <b>Luật riêng</b> có hai cài đặt. App cố xếp theo, nhưng không phá luật
          bắt buộc bên dưới (luôn có Bếp/Bồi, mở/đóng cửa, số người tối thiểu T6–CN).
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>Độ dài ca</b> (ví dụ 2–3h): mỗi ca của người đó nằm trong khoảng này; số ca trong tháng
            tăng/giảm cho đủ định mức.
          </li>
          <li>
            <b>Khung giờ ưu tiên</b> (ví dụ T2–T6 10:30–15:00, hoặc cả tuần 12:00–14:00 + 18:00–20:00):
            app ưu tiên xếp người đó vào những ngày và giờ này. Có hai khung trong ngày thì người bán thời
            gian cũng được xếp ca gãy theo hai khung.
          </li>
          <li>
            <b>Rải đều trong tháng</b>: chia ca của người đó đều theo tuần (tính trên các ngày ưu tiên),
            thay vì dồn vào tuần đang thiếu người. Có Độ dài ca thì app chọn nhiều ca ngắn hơn (ví dụ 10 ca
            2h thay vì 8 ca 2,5h).
          </li>
        </ul>
      </Section>

      <Section title="Nguyên tắc bắt buộc (luôn đúng)">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Tối đa <b>{isThienlong ? 10 : 8} giờ công</b> mỗi ngày
            {isThienlong && <>; ca liên tục có thể kéo dài đến <b>11 giờ có mặt</b> gồm giờ nghỉ</>}.
          </li>
          <li>Mỗi người làm tối đa <b>một ngày công/ngày</b>, có thể gồm <b>hai khung giờ tách rời</b>.</li>
          <li>Không làm quá <b>6 ngày liên tiếp</b>, nên luôn có ít nhất một ngày nghỉ mỗi tuần.</li>
          <li>
            Ngày nghỉ cố định áp dụng ở cả hai quán như quy tắc cứng:
            <b> Vollzeit chọn 1 ngày/tuần</b>, <b>Azubi chọn 2 ngày/tuần</b>; thuật toán
            và thao tác chuyển ca đều không được xếp vào các ngày đó.
          </li>
          {isThienlong ? (
            <>
              <li>Mỗi ngày mở cửa có ít nhất <b>2 nhân viên đến trước giờ mở cửa 30 phút</b>.</li>
              <li>
                <b>Thứ 6, Thứ 7, Chủ Nhật</b>: từ{" "}
                <b>14:00–17:00</b> ít nhất <b>3 Bếp + 1 Bồi</b>; từ <b>20:00–22:00</b> ít nhất{" "}
                <b>2 Bếp + 1 Bồi</b>.
              </li>
              <li>
                <b>Ngày cuối tháng (30/31) và mồng 1–3</b> (ưu tiên mềm, xếp khi có thể): hơi đông
                hơn ngày thường (trọng số 1,15), nhưng ít hơn Thứ 7 (1,35); không có mức tối thiểu.
              </li>
            </>
          ) : (
            <li>
              Không xếp ca trước giờ mở cửa; hai giờ cao điểm có ít nhất <b>2 nhân viên</b>.
            </li>
          )}
          <li>
            Mỗi người phải đạt <b>đúng định mức tháng</b> (Sollstunden) — không thừa, không thiếu.
          </li>
          <li>
            Ca liền trên 6 giờ công nghỉ <b>30 phút</b>, từ 8 giờ công trở lên nghỉ <b>60 phút</b>.
            Ca tách đôi không trừ Pause vì quãng nghỉ giữa hai đoạn (ít nhất <b>1 giờ</b>, ví dụ
            tiệm đóng cửa 15:00–16:30) đã là thời gian nghỉ.
          </li>
          <li>
            <b>Không xếp ai vào quãng đóng cửa.</b> Một ngày công có thể gồm hai đoạn nằm ở hai
            khung trước và sau giờ đóng cửa buổi trưa.
          </li>
        </ul>
      </Section>

      <Section title="1) Trọng số nhu cầu theo ngày">
        <p>
          Dùng để chia <b>tổng giờ công cả tháng</b> ra từng ngày: ngày trọng số cao được xếp nhiều giờ
          hơn. Đây là hệ số tương đối, ngày thường = 1.0.
        </p>
        <WeekdayTable
          values={dayWeights}
          format={(v) => v.toFixed(2).replace(".", ",")}
          highlight={(k) => dayWeights[k] > 1}
        />
        <p className="text-slate-600">
          Công thức mỗi ngày: <code>giờ ngày = tổng giờ tháng × trọng số ngày ÷ tổng trọng số</code>.
          <br />
          {isThienlong ? (
            <>
              <b>Thứ 2–Thứ 5</b> dùng mức nền 1,00; <b>Thứ 6–Thứ 7</b> dùng mức 1,35 và <b>Chủ Nhật</b> dùng mức 1,10.
            </>
          ) : (
            <>
              <b>Thứ 6 và Thứ 7</b> cao hơn ngày thường khoảng 20%; <b>Chủ Nhật</b> chỉ nhỉnh hơn nhẹ.
            </>
          )}{" "}
          Ngày{" "}
          <b>đóng cửa</b> có trọng số 0 (không xếp giờ, giờ dồn sang ngày khác).
        </p>
        {isThienlong && (
          <p className="text-slate-600">
            Giờ mỗi ngày được chia <b>thuần theo tỉ lệ</b> ở trên (không còn mốc giờ cố định
            nào) nên luôn co giãn đúng theo tổng giờ của quán: mỗi ngày Thứ 6/Thứ 7 nặng hơn ngày
            thường ~35%, Chủ Nhật ~20%. Về số người, Thứ 2–Thứ 5 được ưu tiên khoảng <b>6–7 người</b>,
            Thứ 6–Thứ 7–Chủ Nhật có trần cứng <b>8 người/ngày</b>; thuật toán không thay đổi định
            mức hay thông tin đã lưu của nhân viên.
          </p>
        )}
      </Section>

      <Section title="2) Tỉ lệ ca tối vs ca sáng">
        <p>
          Với số giờ đã chia cho mỗi ngày, phần trăm dưới đây là <b>tỉ lệ giờ dành cho ca tối</b> (phần
          còn lại là ca sáng). <b>Tối luôn đông hơn sáng</b> (đều trên 50%), trong đó T6/T7
          được ưu tiên hơn Chủ Nhật.
        </p>
        <WeekdayTable
          values={lateShiftRatios}
          format={(v) => Math.round(v * 100) + "%"}
          highlight={(k) => lateShiftRatios[k] >= 0.7}
        />
        <p className="text-slate-600">
          Ngoài ra: Teilzeit (bán thời gian) thiên về ca tối; Vollzeit (toàn thời gian) cân bằng
          sáng/tối; cuối tuần và ngày lễ dồn mạnh vào buổi tối.
        </p>
      </Section>

      <Section title="3) Độ dài ca co theo khung giờ trong ngày">
        <p>
          Ca sáng nằm trong <b>khung đầu</b>, ca tối nằm trong <b>khung cuối</b>. Ngày có nghỉ trưa
          (Thứ 2–5) có hai khung; một ngày công dài có thể được tách thành hai đoạn. Nếu một ngày mở{" "}
          <b>ngắn hơn</b> (VD nửa buổi), ca sẽ <b>tự co ngắn lại</b> cho vừa khung — kể cả nhân viên toàn
          thời gian vẫn đi làm ca ngắn hôm đó, và <b>định mức tháng vẫn được bù đủ</b> ở các ngày khác.
        </p>
        <p className="text-slate-600">
          Độ dài ca cho phép: {isThienlong ? (
            <><b>3 đến 10 giờ</b>, bước nửa giờ.</>
          ) : (
            <><b>1 đến 8 giờ</b>, bước nửa giờ; Vollzeit bắt đầu từ 4h.</>
          )} Nhờ bước nửa giờ, ca được lắp vừa khung mà không phải làm tròn sai.
          <br />
          Toàn thời gian ưu tiên ca dài hơn, bán thời gian nhận cả dải ca ngắn. Khi khung giờ
          quá hẹp cho ca 6h thì toàn thời gian vẫn được xếp ca ngắn hơn để không phải nghỉ cả ngày.
        </p>
      </Section>

      <Section title="4) Ngày lễ (tự phát hiện — theo bang của cửa hàng)">
        <p>
          Ngày lễ được tính <b>theo bang của cửa hàng đang chọn</b>, gồm cả lễ cố định và lễ theo
          Phục Sinh. Hai tiệm ở <b>Heidenheim</b> nên áp ngày lễ <b>Baden-Württemberg</b>. Ngày lễ
          được xử lý <b>{isThienlong ? "như ngày đông T7" : "như Chủ Nhật"}</b> (nhu cầu + khung giờ riêng). Danh sách lễ trong tháng hiện ở
          tab <b>Cài đặt</b>.
        </p>
        <p className="mt-2">
          Baden-Württemberg có <b>Heilige Drei Könige (6.1)</b>, <b>Fronleichnam</b> và{" "}
          <b>Allerheiligen (1.11)</b>. Không có Reformationstag, cũng không tính Ostersonntag và
          Pfingstsonntag là lễ chính thức — khác hẳn Brandenburg, lệch nhau 6 ngày mỗi năm.
        </p>
      </Section>

      <Section title="5) Ngày đặc biệt (bạn tự đặt)">
        <p>
          Trong tab <b>Cài đặt → Ngày đặc biệt</b>, bạn có thể ghi đè một ngày cụ thể:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>Đóng cửa cả ngày</b>: hôm đó không xếp ai, giờ được dồn sang các ngày khác.
          </li>
          <li>
            <b>Giờ làm riêng</b> (VD nghỉ nửa ngày): mọi người làm ca ngắn lọt khung giờ đó.
          </li>
        </ul>
      </Section>

      <Section title="Lưu ý về tờ Stundenzettel">
        <p>
          Giao diện app bằng tiếng Việt, nhưng tờ in <b>Stundenaufzeichnung</b> giữ nguyên{" "}
          <b>tiếng Đức</b> theo mẫu để nộp tại Đức. Ngày lễ/ngày đóng cửa được ghi chú trên tờ này
          (VD <i>Feiertag</i>, <i>Betriebsruhe</i>).
        </p>
      </Section>
    </div>
  );
}
