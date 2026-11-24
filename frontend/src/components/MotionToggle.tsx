import React from 'react';
import { Cpu, Sparkles, ZapOff } from 'lucide-react';
import { MotionMode, useMotionStore } from '../store/useMotionStore';
import { IconSegmentedControl, IconSegmentedOption } from './IconSegmentedControl';

export const MotionToggle: React.FC = () => {
  const { motionMode, autoSummary, setMotionMode } = useMotionStore();

  const options: IconSegmentedOption<MotionMode>[] = [
    {
      value: 'auto',
      label: '自动（按性能）',
      tooltip: `自动 · ${autoSummary}`,
      icon: Cpu,
    },
    {
      value: 'full',
      label: '开启全部动效',
      tooltip: '开启全部动效',
      icon: Sparkles,
    },
    {
      value: 'off',
      label: '关闭动效',
      tooltip: '关闭动效',
      icon: ZapOff,
    },
  ];

  return (
    <IconSegmentedControl
      value={motionMode}
      onChange={setMotionMode}
      options={options}
      ariaLabel="过渡动效模式切换"
      layoutIdPrefix="motion-pill"
    />
  );
};
