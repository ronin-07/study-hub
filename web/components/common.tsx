import type { ReactNode } from 'react';
import { CalendarDays, Clock3 } from 'lucide-react';
import { formatDate, type Item } from '@/lib/types';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={'card ' + className}>{children}</section>;
}
export function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="empty-state">{icon}<strong>{title}</strong><p>{detail}</p></div>;
}
export function SectionTitle({ title, aside }: { title: string; aside?: ReactNode }) {
  return <div className="section-title"><h3>{title}</h3>{aside}</div>;
}
export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'good' | 'warning' | 'danger' }) {
  return <span className={'badge ' + tone}>{children}</span>;
}
export function DayStatus({ i }: { i: Item }) {
  return <div className="item-dates">{i.planned_date && <span><CalendarDays size={13}/> Planned {formatDate(i.planned_date)}</span>}{i.due_date && <span><Clock3 size={13}/> Due {formatDate(i.due_date)}</span>}</div>;
}
export function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return <label className="form-row"><span>{label}</span>{children}</label>;
}
