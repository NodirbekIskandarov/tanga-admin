import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useUsersQuery } from "../store/api";
import { setUserFilters } from "../store/uiSlice";
import { Card, Empty, ErrorBox, Loading, Pager, Tag } from "../components/common";
import { day, usd } from "../lib/format";

const STATES = [
  ["", "Hammasi"],
  ["obunachi", "Obunachilar"],
  ["sinov", "Bepul sinovda"],
  ["tugagan", "Muddati tugagan"],
  ["bloklangan", "Bloklangan"],
  ["ega", "Egalar"],
];

const ORDERS = [
  ["yangi", "Yangi qo'shilgan"],
  ["faol", "Oxirgi faollik"],
  ["yozuv", "Yozuvlar soni"],
  ["xarajat", "AI xarajati"],
];

export default function Users() {
  const dispatch = useDispatch();
  const filters = useSelector((s) => s.ui.userFilters);
  const { data, isFetching, error, refetch } = useUsersQuery(filters);

  const set = (patch) => dispatch(setUserFilters(patch));

  return (
    <>
      <Card>
        <div className="pad">
          <div className="row">
            <label className="fld grow" style={{ margin: 0 }}>
              <span>Qidiruv</span>
              <input
                type="text"
                placeholder="Ism, username yoki ID"
                value={filters.q}
                maxLength={64}
                onChange={(e) => set({ q: e.target.value })}
              />
            </label>
            <label className="fld" style={{ margin: 0, minWidth: 170 }}>
              <span>Holat</span>
              <select
                value={filters.holat}
                onChange={(e) => set({ holat: e.target.value })}
              >
                {STATES.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld" style={{ margin: 0, minWidth: 170 }}>
              <span>Tartib</span>
              <select
                value={filters.tartib}
                onChange={(e) => set({ tartib: e.target.value })}
              >
                {ORDERS.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {(filters.q || filters.holat) && (
              <button
                className="btn"
                onClick={() => set({ q: "", holat: "", sahifa: 1 })}
              >
                Tozalash
              </button>
            )}
            <a className="btn" href="/api/export/users.csv">
              ⬇ CSV
            </a>
          </div>
        </div>
      </Card>

      {error && <ErrorBox error={error} onRetry={refetch} />}

      <Card
        title={
          data ? `${data.total} ta foydalanuvchi` : "Foydalanuvchilar"
        }
      >
        {isFetching && !data ? (
          <Loading />
        ) : (
          <>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Foydalanuvchi</th>
                    <th>ID</th>
                    <th>Holat</th>
                    <th className="num">Qoldi</th>
                    <th className="num">Yozuv</th>
                    <th className="num">AI sarfi</th>
                    <th>Oxirgi faollik</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data?.items.length === 0 && (
                    <Empty colSpan={8}>Hech narsa topilmadi.</Empty>
                  )}
                  {data?.items.map((r) => (
                    <tr key={r.user_id}>
                      <td>
                        <Link to={`/foydalanuvchilar/${r.user_id}`}>
                          <b>{r.first_name || "Nomsiz"}</b>
                        </Link>
                        {r.username && (
                          <div className="muted" style={{ fontSize: 12.5 }}>
                            @{r.username}
                          </div>
                        )}
                      </td>
                      <td className="mono">{r.user_id}</td>
                      <td>
                        <Tag kind={r.state}>{r.state}</Tag>
                      </td>
                      <td className="num">
                        {r.days_left != null ? r.days_left : "—"}
                      </td>
                      <td className="num">{r.tx_count}</td>
                      <td className="num">{usd(r.cost_usd)}</td>
                      <td className="mono nowrap">{day(r.last_seen_at)}</td>
                      <td className="nowrap">
                        <Link className="btn sm" to={`/foydalanuvchilar/${r.user_id}`}>
                          Boshqarish
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={data?.page || 1}
              pages={data?.pages || 1}
              total={data?.total}
              onChange={(p) => set({ sahifa: p })}
            />
          </>
        )}
      </Card>
    </>
  );
}
