import { useTranslation } from 'react-i18next'
import Modal from './Modal'
import Button from './Button'

interface Props {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  /** Override the confirm button label (defaults to "Delete"). */
  confirmLabel?: string
}

export default function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  busy,
  confirmLabel,
}: Props) {
  const { t } = useTranslation()
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {confirmLabel ?? t('common.delete')}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-400">{message}</p>
    </Modal>
  )
}
