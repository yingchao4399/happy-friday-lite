import { defineStore } from 'pinia'
import { electronService } from '@/services/electron'
import {readNote,saveNote} from '@/features/notes/documents'

const DEBOUNCE_MS = 800

function deriveNoteTitle(title, contentText) {
  const current = String(title || '').trim()
  if (current && !['新建笔记', 'Untitled', 'Untitled Note'].includes(current)) return current
  const text = String(contentText || '').replace(/\s+/g, ' ').trim()
  if (!text) return current || '新建笔记'
  const heading = String(contentText || '').split(/\r?\n/).map(line => line.replace(/^\s*#+\s*/, '').trim()).find(Boolean)
  return (heading || text).slice(0, 80)
}

export const useNoteStore = defineStore('note', {
  state: () => ({
    notes: [],
    currentNoteId: null,
    loading: false,
    saving: false,
    _saveTimer: null,
    _pendingSave: null,
    _savePromise: null
  }),

  getters: {
    currentNote(state) {
      return state.notes.find(n => n.id === state.currentNoteId)
    }
  },

  actions: {
    async fetchNotes(knowledgeBaseId, notebookId) {
      this.loading = true
      try {
        const notes = await electronService.invoke('get_notes', {
          knowledgeBaseId: knowledgeBaseId ?? null,
          notebookId: notebookId ?? null
        })
        this.notes = notes || []
      } finally {
        this.loading = false
      }
    },

    async fetchNote(noteId) {
      const note = await readNote(noteId)
      if (note) {
        const idx = this.notes.findIndex(n => n.id === noteId)
        if (idx >= 0) {
          this.notes[idx] = note
        } else {
          this.notes.unshift(note)
        }
      }
      return note
    },

    async createNote(knowledgeBaseId, title, notebookId) {
      const note = await electronService.invoke('create_note', {
        knowledgeBaseId: knowledgeBaseId ?? null,
        notebookId: notebookId ?? null,
        title: title ?? null
      })
      if (!note) {
        return null
      }
      this.notes.unshift(note)
      this.currentNoteId = note.id
      return note
    },

    async importNote(knowledgeBaseId, notebookId, title, content, contentText) {
      const note = await electronService.invoke('import_note', {
        knowledgeBaseId: knowledgeBaseId ?? null,
        notebookId: notebookId ?? null,
        title: title ?? null,
        content: content ?? '',
        contentText: contentText ?? ''
      })
      if (!note) {
        return null
      }
      this.notes.unshift(note)
      return note
    },

    async deleteNote(noteId) {
      await this.flushPendingSave()
      const deleted = await electronService.request('delete_note', { noteId })
      if (!deleted) throw new Error('Note was not deleted')
      this.notes = this.notes.filter(n => n.id !== noteId)
      if (this.currentNoteId === noteId) {
        this.currentNoteId = this.notes.length > 0 ? this.notes[0].id : null
      }
    },

    async searchNotes(query) {
      this.loading = true
      try {
        const notes = await electronService.invoke('search_notes', { query })
        this.notes = notes || []
      } finally {
        this.loading = false
      }
    },

    selectNote(noteId) {
      this.currentNoteId = noteId
    },

    scheduleSave(noteId, title, content, contentText, marpContent) {
      this._pendingSave = { noteId, title, content, contentText, marpContent, baseRevision: this._pendingSave?.noteId === noteId ? this._pendingSave.baseRevision : (this.notes.find(n => n.id === noteId)?.revision || 0) }

      if (this._saveTimer) {
        clearTimeout(this._saveTimer)
      }

      this._saveTimer = setTimeout(() => {
        void this._flushSave().catch(() => {})
      }, DEBOUNCE_MS)
    },

    async flushPendingSave() {
      if (this._saveTimer) {
        clearTimeout(this._saveTimer)
        this._saveTimer = null
      }
      if (this._savePromise) await this._savePromise
      if (this._pendingSave) {
        await this._flushSave()
      }
    },

    async _flushSave() {
      if(this._savePromise){await this._savePromise;if(this._pendingSave)return this._flushSave();return}
      const task=this._performSave();this._savePromise=task
      try{await task}finally{this._savePromise=null}
    },

    async _performSave() {
      this._saveTimer = null
      const pending = this._pendingSave
      if (!pending) return

      this._pendingSave = null
      this.saving = true
      try {
        const note = this.notes.find(n => n.id === pending.noteId)
        const notebookId = note?.notebookId ?? null
        const effectiveTitle = deriveNoteTitle(pending.title, pending.contentText)

        const updated = await saveNote({
          noteId: pending.noteId,
          baseRevision: pending.baseRevision,
          title: effectiveTitle,
          content: pending.content,
          contentText: pending.contentText,
          notebookId,
          ...(pending.marpContent !== undefined ? { marpContent: pending.marpContent } : {})
        })
        if(this._pendingSave?.noteId===pending.noteId&&this._pendingSave.baseRevision===pending.baseRevision)this._pendingSave.baseRevision=updated.revision

        if (note) {
          note.title = effectiveTitle
          note.content = pending.content
          note.contentText = pending.contentText
          if (pending.marpContent !== undefined) {
            note.marpContent = pending.marpContent
          }
          note.updatedAt = updated.updatedAt
          note.revision = updated.revision
        }
      } catch (error) {
        this._pendingSave ||= pending
        window.dispatchEvent(new CustomEvent('friday:note-save-error', {detail:{noteId:pending.noteId,code:error.message}}))
        throw error
      } finally {
        this.saving = false
      }
    }
  }
})
