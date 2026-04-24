import { Empty, Button } from 'antd';
import type { ReactNode } from 'react';

export default function EmptyState({
  title, description, actionText, onAction, image,
}: {
  title?: string;
  description?: ReactNode;
  actionText?: string;
  onAction?: () => void;
  image?: ReactNode;
}) {
  return (
    <div style={{ padding: '60px 0', display: 'flex', justifyContent: 'center' }}>
      <Empty
        image={image ?? Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div>
            {title && <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>}
            {description && <div style={{ fontSize: 12, opacity: 0.75 }}>{description}</div>}
          </div>
        }
      >
        {actionText && onAction && (
          <Button type="primary" onClick={onAction}>{actionText}</Button>
        )}
      </Empty>
    </div>
  );
}
