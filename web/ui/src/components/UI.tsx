import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { ArrowUpRight, Search, CircleHelp } from "lucide-react";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
export function Button({ children, variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; }) {
  return <button {...props} className={`button button--${variant} ${className}`.trim()}>{children}</button>;
}
export function IconButton({ children, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" {...props} aria-label={label} title={label} className={`icon-button ${props.className ?? ""}`.trim()}>{children}</button>;
}
export function Card({ children, className = "", ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section {...props} className={`card ${className}`.trim()}>{children}</section>;
}
export function SectionHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{children}</div>;
}
export function SearchInput({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="search-field"><Search size={17} aria-hidden="true"/><span className="sr-only">{label}</span><input type="search" aria-label={label} {...props}/></label>;
}
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton-list" role="status" aria-label="Carregando"><span className="sr-only">Carregando conteúdo</span>{Array.from({ length: lines }, (_, i) => <span aria-hidden="true" className="skeleton" key={i}/>)}</div>;
}
export function EmptyState({ title, message }: { title: string; message: string }) {
  return <div className="empty-state"><CircleHelp aria-hidden="true" size={24}/><strong>{title}</strong><p>{message}</p></div>;
}
export function StatCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return <Card className="stat-card"><div className="stat-top"><span className="stat-icon">{icon}</span><ArrowUpRight size={16} className="muted" aria-hidden="true"/></div><p className="stat-label">{label}</p><strong className="stat-value">{value}</strong><p className="stat-detail">{detail}</p></Card>;
}
export function ProgressPill({ label, value }: { label: string; value: number }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return <div className="progress-row"><div className="progress-label"><span>{label}</span><strong>{safeValue}%</strong></div><div className="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeValue}><div className="progress-fill" style={{ width: `${safeValue}%` }}/></div></div>;
}
export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return <div className="notice" role="note"><strong>{title}</strong><span>{children}</span></div>;
}
