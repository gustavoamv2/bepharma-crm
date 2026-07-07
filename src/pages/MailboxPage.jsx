import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { Link } from 'react-router-dom'
import { Archive, Inbox, Mail, MailOpen, RefreshCw, Reply, Search, Send, Unlink } from 'lucide-react'
import Topbar from '../components/Topbar'
import EmailComposer from '../components/EmailComposer'
import { mailbox } from '../hooks/useApi'
import { useToast } from '../hooks/useToast'

const folders = [
  { id: 'inbox', label: 'Entrada', icon: Inbox },
  { id: 'sent', label: 'Enviados', icon: Send },
  { id: 'unlinked', label: 'Sin vincular', icon: Unlink },
  { id: 'archived', label: 'Archivados', icon: Archive },
  { id: 'all', label: 'Todo', icon: Mail },
]

const fmt = (value) => {
  if (!value) return '--'
  try {
    return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  } catch {
    return value
  }
}

const emailText = (value) => Array.isArray(value) ? value.join(', ') : (value || '--')

export default function MailboxPage() {
  const qc = useQueryClient()
  const { addToast: toast } = useToast()
  const [folder, setFolder] = useState('inbox')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [replying, setReplying] = useState(false)

  const params = useMemo(() => ({ folder, q: q.trim() || undefined, limit: 120 }), [folder, q])
  const messagesQuery = useQuery(['mailbox', params], () => mailbox.list(params), { keepPreviousData: true })
  const messages = messagesQuery.data?.messages || []
  const selectedMessage = selected || messages[0] || null

  const threadQuery = useQuery(
    ['mailbox-thread', selectedMessage?.threadId],
    () => mailbox.thread(selectedMessage.threadId),
    { enabled: Boolean(selectedMessage?.threadId) }
  )
  const threadMessages = threadQuery.data?.messages?.length ? threadQuery.data.messages : (selectedMessage ? [selectedMessage] : [])

  const sync = async () => {
    try {
      const result = await mailbox.sync()
      toast(`Buzon sincronizado: ${result.upserted || 0} mensajes`, 'success')
      qc.invalidateQueries('mailbox')
    } catch (e) {
      toast('No se pudo sincronizar Resend: ' + (e.response?.data?.error || e.message), 'error')
    }
  }

  const markRead = async (message) => {
    setSelected(message)
    if (!message?.readAt) {
      try {
        await mailbox.patch(message.id, { readAt: new Date().toISOString() })
        qc.invalidateQueries('mailbox')
      } catch { /* best effort */ }
    }
  }

  const archive = async (message, archived) => {
    if (!message) return
    try {
      await mailbox.patch(message.id, { folder: archived ? 'archived' : 'inbox' })
      toast(archived ? 'Mensaje archivado' : 'Mensaje restaurado', 'success')
      qc.invalidateQueries('mailbox')
    } catch (e) {
      toast('No se pudo actualizar el mensaje: ' + (e.response?.data?.error || e.message), 'error')
    }
  }

  const latestInbound = [...threadMessages].reverse().find(m => m.direction === 'inbound') || selectedMessage
  const replyTo = latestInbound?.from || ''
  const replySubject = selectedMessage?.subject?.toLowerCase().startsWith('re:') ? selectedMessage.subject : `Re: ${selectedMessage?.subject || ''}`
  const replyReferences = [latestInbound?.references, latestInbound?.messageId].filter(Boolean).join(' ')

  return (
    <>
      <Topbar title="Buzon" action={
        <button className="btn btn-primary" onClick={sync} disabled={messagesQuery.isFetching}>
          <RefreshCw size={15} /> Sincronizar
        </button>
      } />
      <div className="content mailbox-page">
        <aside className="mailbox-folders">
          {folders.map(item => {
            const Icon = item.icon
            return (
              <button key={item.id} className={folder === item.id ? 'active' : ''} onClick={() => { setFolder(item.id); setSelected(null) }}>
                <Icon size={16} /> {item.label}
              </button>
            )
          })}
        </aside>

        <section className="mailbox-list-panel">
          <div className="mailbox-search">
            <Search size={15} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar asunto, remitente o empresa" />
          </div>
          <div className="mailbox-list">
            {messagesQuery.isLoading && <div className="mailbox-empty">Cargando correos...</div>}
            {!messagesQuery.isLoading && !messages.length && <div className="mailbox-empty">Sin correos en esta bandeja</div>}
            {messages.map(message => (
              <button key={message.id} className={`mailbox-row ${selectedMessage?.id === message.id ? 'active' : ''} ${message.readAt ? '' : 'unread'}`} onClick={() => markRead(message)}>
                <div className="mailbox-row-icon">{message.readAt ? <MailOpen size={15} /> : <Mail size={15} />}</div>
                <div className="mailbox-row-main">
                  <div className="mailbox-row-top"><strong>{message.direction === 'outbound' ? emailText(message.to) : message.from}</strong><span>{fmt(message.createdAt)}</span></div>
                  <div className="mailbox-row-subject">{message.subject || '(sin asunto)'}</div>
                  <div className="mailbox-row-preview">{message.preview || message.text || ''}</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="mailbox-reader">
          {!selectedMessage ? (
            <div className="mailbox-empty reader-empty">Selecciona un correo</div>
          ) : (
            <>
              <div className="mailbox-reader-head">
                <div>
                  <h2>{selectedMessage.subject || '(sin asunto)'}</h2>
                  <div className="mailbox-meta">{selectedMessage.direction === 'outbound' ? 'Para' : 'De'}: {selectedMessage.direction === 'outbound' ? emailText(selectedMessage.to) : selectedMessage.from}</div>
                  <div className="mailbox-meta">Hilo: {threadMessages.length} mensaje(s)</div>
                </div>
                <div className="mailbox-actions">
                  {selectedMessage.dealId && <Link className="btn btn-secondary" to={`/deals/${selectedMessage.dealId}`}>Abrir deal</Link>}
                  <button className="btn btn-secondary" onClick={() => archive(selectedMessage, selectedMessage.folder !== 'archived')}>
                    <Archive size={15} /> {selectedMessage.folder === 'archived' ? 'Restaurar' : 'Archivar'}
                  </button>
                  <button className="btn btn-primary" onClick={() => setReplying(true)} disabled={!replyTo}>
                    <Reply size={15} /> Responder
                  </button>
                </div>
              </div>

              <div className="mailbox-thread">
                {threadMessages.map(message => (
                  <article key={message.id} className={`mailbox-message ${message.direction}`}>
                    <div className="mailbox-message-head"><strong>{message.direction === 'outbound' ? 'Enviado' : 'Recibido'}</strong><span>{fmt(message.createdAt)}</span></div>
                    <div className="mailbox-meta">{message.direction === 'outbound' ? `Para: ${emailText(message.to)}` : `De: ${message.from}`}</div>
                    {message.html ? <div className="mailbox-body" dangerouslySetInnerHTML={{ __html: message.html }} /> : <div className="mailbox-body plain">{message.text || message.preview || ''}</div>}
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {replying && selectedMessage && (
        <EmailComposer
          defaultTo={replyTo}
          defaultSubject={replySubject}
          contactId={selectedMessage.contactId}
          dealId={selectedMessage.dealId}
          companyId={selectedMessage.companyId}
          threadId={selectedMessage.threadId}
          inReplyToMessageId={latestInbound?.messageId || latestInbound?.providerMessageId || latestInbound?.resendEmailId}
          references={replyReferences}
          onClose={() => setReplying(false)}
          onSent={() => { setReplying(false); qc.invalidateQueries('mailbox') }}
        />
      )}
    </>
  )
}
