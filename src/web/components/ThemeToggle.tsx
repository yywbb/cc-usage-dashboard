import { Button, Tooltip } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useTheme } from '../theme/useTheme.js';

export default function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const label = mode === 'dark' ? '切到浅色' : '切到暗色';
  return (
    <Tooltip title={label} placement="bottom">
      <Button
        type="text"
        shape="circle"
        icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        onClick={toggle}
        aria-label={label}
      />
    </Tooltip>
  );
}
