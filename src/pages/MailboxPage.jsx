import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { Link } from 'react-router-dom'
import { Archive, Inbox, Link2, Mail, MailOpen, RefreshCw, Reply, Search, Send, Trash2, Unlink, X } from 'lucide-react'
import Topbar from '../components/Topbar'
import EmailComposer from '../components/EmailComposer'
import { ACTIVE_EVENT } from '../components/RecordModal'
import { hubspot, mailbox } from '../hooks/useApi'
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
const escapeHtml = (value = '') => String(value || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const plainFromHtml = (html = '') => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const estadoLabel = (value) => ({ nueva: 'Nueva', en_depuracion: 'En depuracion', en_enriquecimiento: 'En enriquecimiento', confirmada: 'Confirmada', no_participa: 'No participa' }[value] || value || '--')

export default function MailboxPage() {
  const qc = useQueryClient()
  const { addToast: toast } = useToast()
  const [folder, setFolder] = useState('inbox')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [replying, setReplying] = useState(false)
  const [composing, setComposing] = useState(false)
  const [linkingDeal, setLinkingDeal] = useState(false)
  const [dealSearch, setDealSearch] = useState('')

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

  const dealSelectorQuery = useQuery(
    ['mailbox-deal-selector', dealSearch],
    () => {
      const filters = [{ propertyName: 'bp_evento_codigo', operator: 'EQ', value: ACTIVE_EVENT }]
      if (dealSearch.trim()) filters.push({ propertyName: 'dealname', operator: 'CONTAINS_TOKEN', value: dealSearch.trim() })
      return hubspot.searchDeals({
        filters,
        sorts: [{ propertyName: 'dealname', direction: 'ASCENDING' }],
        limit: 50,
      })
    },
    { enabled: linkingDeal, keepPreviousData: true }
  )
  const selectableDeals = dealSelectorQuery.data?.results || []

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

  const deleteMessage = async (message) => {
    if (!message) return
    if (!window.confirm('Borrar solo este mensaje del hilo?')) return
    try {
      await mailbox.deleteMessage(message.id)
      toast('Mensaje borrado', 'success')
      if (selected?.id === message.id) setSelected(null)
      qc.invalidateQueries('mailbox')
      qc.invalidateQueries('mailbox-thread')
    } catch (e) {
      toast('No se pudo borrar el mensaje: ' + (e.response?.data?.error || e.message), 'error')
    }
  }

  const deleteCurrentThread = async () => {
    if (!selectedMessage?.threadId) return
    if (!window.confirm('Borrar todo este hilo del buzon? Esta accion elimina todos los mensajes del hilo.')) return
    try {
      await mailbox.deleteThread(selectedMessage.threadId)
      toast('Hilo borrado', 'success')
      setSelected(null)
      qc.invalidateQueries('mailbox')
      qc.invalidateQueries('mailbox-thread')
    } catch (e) {
      toast('No se pudo borrar el hilo: ' + (e.response?.data?.error || e.message), 'error')
    }
  }

  const openDealSelector = () => {
    if (!selectedMessage?.threadId) return
    setDealSearch('')
    setLinkingDeal(true)
  }

  const linkCurrentThreadToDeal = async (deal) => {
    if (!selectedMessage?.threadId || !deal?.id) return
    try {
      await mailbox.linkThreadToDeal(selectedMessage.threadId, deal.id)
      toast('Hilo vinculado al deal', 'success')
      setLinkingDeal(false)
      setSelected(null)
      setFolder('all')
      qc.invalidateQueries('mailbox')
      qc.invalidateQueries('mailbox-thread')
    } catch (e) {
      toast('No se pudo vincular el hilo: ' + (e.response?.data?.error || e.message), 'error')
    }
  }

  const latestInbound = [...threadMessages].reverse().find(m => m.direction === 'inbound') || selectedMessage
  const replyTo = latestInbound?.from || ''
  const replySubject = selectedMessage?.subject?.toLowerCase().startsWith('re:') ? selectedMessage.subject : `Re: ${selectedMessage?.subject || ''}`
  const replyReferences = [latestInbound?.references, latestInbound?.messageId].filter(Boolean).join(' ')
  const replyInitialBodyHtml = useMemo(() => {
    if (!selectedMessage) return ''
    const quoted = threadMessages.map(message => {
      const sender = message.direction === 'outbound' ? emailText(message.to) : message.from
      const when = fmt(message.createdAt)
      const quotedText = message.text || plainFromHtml(message.html) || message.preview || ''
      const content = '<div style="white-space:pre-wrap">' + escapeHtml(quotedText) + '</div>'
      return '<div style="margin:12px 0 0;padding-left:12px;border-left:3px solid #d0d7de;color:#475569">' +
        '<div style="font-size:12px;color:#64748b;margin-bottom:6px"><strong>' + escapeHtml(sender) + '</strong> - ' + escapeHtml(when) + '</div>' +
        '<div>' + content + '</div>' +
        '</div>'
    }).join('')
    return '<p><br></p><p><br></p><div style="font-size:12px;color:#64748b;margin:10px 0">----- Mensaje original -----</div>' + quoted
  }, [selectedMessage, threadMessages])

  return (
    <>
      <Topbar title="Buzon" action={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={() => setComposing(true)}>
            <Send size={15} /> Nuevo correo
          </button>
          <button className="btn btn-secondary" onClick={sync} disabled={messagesQuery.isFetching}>
            <RefreshCw size={15} /> Sincronizar
          </button>
        </div>
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
                  {selectedMessage.dealId ? (
                    <Link className="btn btn-secondary" to={`/deals/${selectedMessage.dealId}`}>Abrir deal</Link>
                  ) : (
                    <button className="btn btn-secondary" onClick={openDealSelector}>
                      <Link2 size={15} /> Vincular deal
                    </button>
                  )}
                  <button className="btn btn-secondary" onClick={() => archive(selectedMessage, selectedMessage.folder !== 'archived')}>
                    <Archive size={15} /> {selectedMessage.folder === 'archived' ? 'Restaurar' : 'Archivar'}
                  </button>
                  <button className="btn btn-secondary" onClick={deleteCurrentThread}>
                    <Trash2 size={15} /> Borrar hilo
                  </button>
                  <button className="btn btn-primary" onClick={() => setReplying(true)} disabled={!replyTo}>
                    <Reply size={15} /> Responder
                  </button>
                </div>
              </div>

              <div className="mailbox-thread">
                {threadMessages.map(message => (
                  <article key={message.id} className={`mailbox-message ${message.direction}`}>
                    <div className="mailbox-message-head">
                      <strong>{message.direction === 'outbound' ? 'Enviado' : 'Recibido'}</strong>
                      <div className="mailbox-message-head-actions">
                        <span>{fmt(message.createdAt)}</span>
                        <button type="button" className="mailbox-message-delete" onClick={() => deleteMessage(message)} title="Borrar solo este mensaje">
                          <Trash2 size={13} /> Borrar
                        </button>
                      </div>
                    </div>
                    <div className="mailbox-meta">{message.direction === 'outbound' ? `Para: ${emailText(message.to)}` : `De: ${message.from}`}</div>
                    {message.html ? <div className="mailbox-body" dangerouslySetInnerHTML={{ __html: message.html }} /> : <div className="mailbox-body plain">{message.text || message.preview || ''}</div>}
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>


      {linkingDeal && selectedMessage && (
        <div className="mailbox-deal-modal-overlay" onClick={e => e.target === e.currentTarget && setLinkingDeal(false)}>
          <div className="mailbox-deal-modal">
            <div className="mailbox-deal-modal-head">
              <div>
                <h2>Vincular correo a Mis eventos</h2>
                <p>Selecciona el deal ya creado para asociar este hilo completo.</p>
              </div>
              <button type="button" className="mailbox-deal-modal-close" onClick={() => setLinkingDeal(false)} title="Cerrar">
                <X size={16} />
              </button>
            </div>
            <div className="mailbox-search mailbox-deal-search">
              <Search size={15} />
              <input value={dealSearch} onChange={e => setDealSearch(e.target.value)} placeholder="Buscar en Mis eventos" autoFocus />
            </div>
            <div className="mailbox-deal-list">
              {dealSelectorQuery.isLoading && <div className="mailbox-empty">Cargando eventos...</div>}
              {!dealSelectorQuery.isLoading && !selectableDeals.length && <div className="mailbox-empty">No se encontraron eventos</div>}
              {selectableDeals.map(deal => {
                const p = deal.properties || {}
                return (
                  <button key={deal.id} type="button" className="mailbox-deal-option" onClick={() => linkCurrentThreadToDeal(deal)}>
                    <div>
                      <strong>{p.dealname || '(sin nombre)'}</strong>
                      <span>{p.bp_zona || '--'} · {p.bp_evento_paises || '--'} · {estadoLabel(p.bp_estado_prospeccion)}</span>
                    </div>
                    <Link2 size={15} />
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {composing && (
        <EmailComposer
          onClose={() => setComposing(false)}
          onSent={() => { setComposing(false); setFolder('sent'); qc.invalidateQueries('mailbox') }}
        />
      )}

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
          initialBodyHtml={replyInitialBodyHtml}
          onClose={() => setReplying(false)}
          onSent={() => { setReplying(false); qc.invalidateQueries('mailbox') }}
        />
      )}
    </>
  )
}


