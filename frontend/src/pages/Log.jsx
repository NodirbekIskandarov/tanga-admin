import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useLogQuery } from "../store/api";
import { setLogPage } from "../store/uiSlice";
import { Card, Empty, ErrorBox, Loading, Pager } from "../components/common";
import { dt } from "../lib/format";

export default function Log() {
  const dispatch = useDispatch();
  const page = useSelector((s) => s.ui.logPage);
  const { data, isFetching, error, refetch } = useLogQuery(page);

  if (error) return <ErrorBox error={error} onRetry={refetch} />;
  if (!data && isFetching) return <Loading />;

  return (
    <>
      <Card title={`${data?.total ?? 0} ta yozuv`}>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Vaqt</th>
                <th>Admin</th>
                <th>Amal</th>
                <th>Nishon</th>
                <th>Tafsilot</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.length === 0 && <Empty colSpan={6}>Jurnal bo'sh.</Empty>}
              {data?.items.map((r) => (
                <tr key={r.id}>
                  <td className="mono nowrap">{dt(r.created_at)}</td>
                  <td>
                    <b>{r.admin}</b>
                  </td>
                  <td>{r.action}</td>
                  <td className="mono">
                    {/^\d+$/.test(r.target || "") ? (
                      <Link to={`/foydalanuvchilar/${r.target}`}>{r.target}</Link>
                    ) : (
                      r.target || "—"
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {r.details}
                  </td>
                  <td className="mono muted" style={{ fontSize: 12 }}>
                    {r.ip}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager
          page={data?.page || 1}
          pages={data?.pages || 1}
          onChange={(p) => dispatch(setLogPage(p))}
        />
      </Card>

      <div className="note">
        Jurnal barcha admin amallarini yozib boradi: kirish, obuna berish,
        bloklash, o'chirish va ommaviy xabar. O'chirib bo'lmaydi — bu ataylab
        shunday.
      </div>
    </>
  );
}
