import React from 'react';
import { CalendarClock, Timer } from 'lucide-react';
import { useResetTimeStore } from '../store/useResetTimeStore';
import { ResetTimeFormat } from '../utils/quota';
import { IconSegmentedControl, IconSegmentedOption } from './IconSegmentedControl';

export const ResetTimeModeToggle: React.FC = () => {
  const { resetTimeFormat, setResetTimeFormat } = useResetTimeStore();

  const options: IconSegmentedOption<ResetTimeFormat>[] = [
    {
      value: 'countdown',
      label: '倒计时',
      tooltip: '倒计时 · 如 6天5小时',
      icon: Timer,
    },
    {
      value: 'absolute',
      label: '具体时间',
      tooltip: '具体时间 · 如 11月29日 06:38',
      icon: CalendarClock,
    },
  ];

  return (
    <IconSegmentedControl
      value={resetTimeFormat}
      onChange={setResetTimeFormat}
      options={options}
      ariaLabel="重置时间显示格式切换"
      layoutIdPrefix="reset-time-pill"
    />
  );
};
