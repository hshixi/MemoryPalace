import { IconCheck } from "./Icons";

export default function Toast({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast-icon">
        <IconCheck size={13} />
      </span>
      <div className="toast-text">
        <div className="toast-title">{title}</div>
        {detail && <div className="toast-detail">{detail}</div>}
      </div>
    </div>
  );
}
