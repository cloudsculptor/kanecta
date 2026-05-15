import { useState } from 'react';
import { FilterBar } from '../../shared/FilterBar';
import { useAllItems } from '../../../hooks/useAllItems';
import { useUiStore } from '../../../store/ui';
import { itemsOnDate } from '../../../lib/items';
import './CalendarView.scss';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CalendarViewProps {
  panelId: string;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export function CalendarView({ panelId }: CalendarViewProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const { items, isLoading, filter } = useAllItems(panelId);
  const { setPanelFilter, setFocusedItem } = useUiStore();

  const navigate = (delta: number) => {
    setMonth((m) => {
      const newM = m + delta;
      if (newM < 0) { setYear((y) => y - 1); return 11; }
      if (newM > 11) { setYear((y) => y + 1); return 0; }
      return newM;
    });
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);
  const prevMonthDays = getDaysInMonth(year, month - 1 < 0 ? 11 : month - 1);

  const cells: { day: number; currentMonth: boolean }[] = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push({ day: prevMonthDays - firstDow + 1 + i, currentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, currentMonth: true });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: cells.length - firstDow - daysInMonth + 1, currentMonth: false });
  }

  if (isLoading) return <div className="CalendarView"><div style={{ padding: 24 }}>Loading…</div></div>;

  const monthName = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div className="CalendarView" data-testid={`calendar-view-${panelId}`}>
      <div className="CalendarView-controls">
        <FilterBar
          filter={filter}
          onChange={(f) => setPanelFilter(panelId, f)}
          totalCount={items.length}
          filteredCount={items.length}
        />
      </div>
      <div className="CalendarView-nav">
        <button className="CalendarView-nav-btn" onClick={() => navigate(-1)} aria-label="Previous month">‹</button>
        <span className="CalendarView-nav-title">{monthName}</span>
        <button className="CalendarView-nav-btn" onClick={() => navigate(1)} aria-label="Next month">›</button>
        <button
          className="CalendarView-nav-btn"
          onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}
        >
          Today
        </button>
      </div>
      <div className="CalendarView-grid">
        {DOW.map((d) => (
          <div key={d} className="CalendarView-day-header">{d}</div>
        ))}
        {cells.map((cell, i) => {
          const isToday = cell.currentMonth &&
            cell.day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
          const dayItems = cell.currentMonth ? itemsOnDate(items, year, month, cell.day) : [];
          return (
            <div
              key={i}
              className={[
                'CalendarView-day',
                !cell.currentMonth ? 'CalendarView-day--other-month' : '',
                isToday ? 'CalendarView-day--today' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="CalendarView-day-num">{cell.day}</div>
              <div className="CalendarView-day-items">
                {dayItems.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    className="CalendarView-day-chip"
                    onClick={() => setFocusedItem(item.id)}
                    title={item.value}
                  >
                    {item.value}
                  </div>
                ))}
                {dayItems.length > 3 && (
                  <div className="CalendarView-day-more">+{dayItems.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
