import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { dismissToast } from "../store/uiSlice";

function Toast({ toast }) {
  const dispatch = useDispatch();
  useEffect(() => {
    const timer = setTimeout(() => dispatch(dismissToast(toast.id)), 5000);
    return () => clearTimeout(timer);
  }, [dispatch, toast.id]);
  return (
    <div
      className={`toast ${toast.kind}`}
      onClick={() => dispatch(dismissToast(toast.id))}
      role="status"
    >
      {toast.text}
    </div>
  );
}

export default function Toasts() {
  const toasts = useSelector((s) => s.ui.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </div>
  );
}
