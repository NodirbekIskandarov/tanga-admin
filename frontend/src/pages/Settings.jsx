import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch } from "react-redux";
import { useSaveSettingsMutation, useSettingsQuery } from "../store/api";
import { pushToast } from "../store/uiSlice";
import { Card, ErrorBox, Loading } from "../components/common";
import { som } from "../lib/format";

/** «179 000» ham, «179000» ham qabul qilinadi. */
function toNumber(raw) {
  const digits = String(raw).replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function group(value) {
  return toNumber(value).toLocaleString("ru-RU").replace(/ /g, " ");
}

export default function Settings() {
  const dispatch = useDispatch();
  const { data, isLoading, error, refetch } = useSettingsQuery();
  const [save, { isLoading: saving }] = useSaveSettingsMutation();

  const [prices, setPrices] = useState({});
  const [bot, setBot] = useState({});

  // Server qiymatlari kelgach maydonlarni to'ldiramiz. Foydalanuvchi
  // yozayotgan bo'lsa ustidan yozib yubormaslik uchun faqat bir marta.
  useEffect(() => {
    if (!data) return;
    setPrices(Object.fromEntries(data.plans.map((p) => [p.code, group(p.price)])));
    setBot({
      card_number: data.bot.card_number || "",
      card_holder: data.bot.card_holder || "",
      trial_days: String(data.bot.trial_days),
      ai_monthly_budget_usd: String(data.bot.ai_monthly_budget_usd),
    });
  }, [data]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  async function onSave() {
    try {
      const res = await save({
        plan_price_1m: toNumber(prices["1m"]),
        plan_price_3m: toNumber(prices["3m"]),
        plan_price_6m: toNumber(prices["6m"]),
        plan_price_12m: toNumber(prices["12m"]),
        card_number: bot.card_number.trim(),
        card_holder: bot.card_holder.trim(),
        trial_days: Number(bot.trial_days) || 7,
        ai_monthly_budget_usd: Number(bot.ai_monthly_budget_usd) || 50,
      }).unwrap();
      dispatch(pushToast(res.message));
    } catch (err) {
      dispatch(pushToast(err?.data?.detail || "Saqlab bo'lmadi.", "bad"));
    }
  }

  return (
    <div className="grid2">
      <Card title="Tariflar">
        <div className="pad stack-sm">
          {data.plans.map((p) => (
            <div className="price-row" key={p.code}>
              <span className="lb">{p.label}</span>
              <input
                type="text"
                inputMode="numeric"
                value={prices[p.code] ?? ""}
                onChange={(e) =>
                  setPrices({ ...prices, [p.code]: e.target.value })
                }
                onBlur={(e) =>
                  setPrices({ ...prices, [p.code]: group(e.target.value) })
                }
              />
              <span className="unit">so'm</span>
            </div>
          ))}
          <button className="btn" disabled={saving} onClick={onSave}>
            {saving ? "Saqlanmoqda…" : "Saqlash"}
          </button>
          <p className="hint" style={{ margin: 0 }}>
            Yangi narx botda darhol ko'rinadi — botni qayta ishga tushirish
            shart emas. Allaqachon to'langan obunalarga ta'sir qilmaydi.
          </p>
        </div>
      </Card>

      <Card title="Bot">
        <div className="pad stack-sm">
          <label className="fld" style={{ margin: 0 }}>
            <span>To'lov kartasi</span>
            <input
              type="text"
              className="mono"
              maxLength={32}
              placeholder="8600 1234 5678 9012"
              value={bot.card_number ?? ""}
              onChange={(e) => setBot({ ...bot, card_number: e.target.value })}
            />
          </label>

          <label className="fld" style={{ margin: 0 }}>
            <span>Karta egasining ismi</span>
            <input
              type="text"
              maxLength={64}
              placeholder="NODIRBEK ISKANDAROV"
              value={bot.card_holder ?? ""}
              onChange={(e) => setBot({ ...bot, card_holder: e.target.value })}
            />
            <span className="hint">
              Bot to'lov ko'rsatmasida karta raqami bilan birga shu ism ko'rsatiladi.
            </span>
          </label>

          <label className="fld" style={{ margin: 0, width: 160 }}>
            <span>Sinov muddati, kun</span>
            <input
              type="number"
              className="mono"
              min={1}
              max={365}
              value={bot.trial_days ?? ""}
              onChange={(e) => setBot({ ...bot, trial_days: e.target.value })}
            />
          </label>

          <label className="fld" style={{ margin: 0, width: 200 }}>
            <span>AI oylik limiti, $</span>
            <input
              type="number"
              className="mono"
              min={1}
              step="1"
              value={bot.ai_monthly_budget_usd ?? ""}
              onChange={(e) =>
                setBot({ ...bot, ai_monthly_budget_usd: e.target.value })
              }
            />
            <span className="hint">
              Taxminan {som((Number(bot.ai_monthly_budget_usd) || 0) * data.usd_rate)} so'm.
              Limitga yetganda bot AI amallarini to'xtatadi.
            </span>
          </label>

          <button className="btn" disabled={saving} onClick={onSave}>
            {saving ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </Card>

      <Card title="Kirish va hisoblar">
        <div className="pad stack-sm">
          <p className="hint" style={{ margin: 0 }}>
            Parol <code>scrypt</code> bilan saqlanadi — bazadan o'qib bo'lmaydi.
            Har bir kirish va amal jurnalga tushadi.
          </p>
          <Link className="btn" to="/parol">
            Parolni almashtirish va admin hisoblari
          </Link>
        </div>
      </Card>
    </div>
  );
}
