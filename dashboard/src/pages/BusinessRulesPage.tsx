import { useEffect, useState, type FormEvent } from 'react'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { BusinessRule } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

type RuleForm = Pick<BusinessRule, 'category' | 'name' | 'content'>
const emptyRule: RuleForm = { category: 'GENERAL', name: '', content: '' }

export function BusinessRulesPage() {
  const { selectedBusiness } = useBusiness()
  const [rules, setRules] = useState<BusinessRule[] | null>(null)
  const [form, setForm] = useState<RuleForm>(emptyRule)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!selectedBusiness) return
    dashboardApi
      .listRules(selectedBusiness.id)
      .then((response) => setRules(response.rules))
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
  }, [selectedBusiness])

  function startEdit(rule: BusinessRule) {
    setEditingRuleId(rule.id)
    setForm({ category: rule.category, name: rule.name, content: rule.content })
    setSuccess(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditingRuleId(null)
    setForm(emptyRule)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBusiness) return
    setError(null)
    setSuccess(null)
    setIsSaving(true)

    try {
      if (editingRuleId) {
        const response = await dashboardApi.updateRule(selectedBusiness.id, editingRuleId, form)
        setRules((current) => current?.map((rule) => (rule.id === editingRuleId ? response.rule : rule)) ?? null)
        setSuccess('Business rule updated.')
      } else {
        const response = await dashboardApi.createRule(selectedBusiness.id, form)
        setRules((current) => [...(current ?? []), response.rule])
        setSuccess('Business rule created.')
      }
      resetForm()
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function toggleRule(rule: BusinessRule) {
    if (!selectedBusiness) return
    setError(null)

    try {
      const response = await dashboardApi.updateRule(selectedBusiness.id, rule.id, {
        active: !rule.active,
      })
      setRules((current) => current?.map((item) => (item.id === rule.id ? response.rule : item)) ?? null)
    } catch (toggleError) {
      setError(getErrorMessage(toggleError))
    }
  }

  if (!rules && !error) return <LoadingBlock label="Loading business rules…" />

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operating policy"
        title="Business rules"
        description="Keep reusable policies factual and active only while they apply. Rules are deactivated rather than deleted."
      />

      <form className="inline-editor" onSubmit={handleSubmit}>
        <div className="inline-editor__heading">
          <h2>{editingRuleId ? 'Edit rule' : 'Add a rule'}</h2>
          {editingRuleId ? <button className="text-button" onClick={resetForm} type="button">Cancel edit</button> : null}
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Category</span>
            <input required value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} />
          </label>
          <label className="field">
            <span>Rule name</span>
            <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="field field--wide">
            <span>Rule content</span>
            <textarea required rows={3} value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} />
          </label>
        </div>
        <button disabled={isSaving} type="submit">{isSaving ? 'Saving…' : editingRuleId ? 'Update rule' : 'Add rule'}</button>
      </form>

      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {success ? <StatusMessage tone="success">{success}</StatusMessage> : null}

      <section aria-labelledby="rules-list-title">
        <div className="section-heading">
          <h2 id="rules-list-title">Saved rules</h2>
          <span>{rules?.length ?? 0} total</span>
        </div>
        {rules?.length ? (
          <div className="record-list">
            {rules.map((rule) => (
              <article className={`record-row${rule.active ? '' : ' record-row--muted'}`} key={rule.id}>
                <div className="record-row__main">
                  <div className="record-row__meta"><span>{rule.category}</span><span>{rule.active ? 'Active' : 'Inactive'}</span></div>
                  <h3>{rule.name}</h3>
                  <p>{rule.content}</p>
                </div>
                <div className="record-row__actions">
                  <button className="secondary-button" onClick={() => startEdit(rule)} type="button">Edit</button>
                  <button className="text-button" onClick={() => void toggleRule(rule)} type="button">{rule.active ? 'Deactivate' : 'Activate'}</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-list">No business rules have been added yet.</p>
        )}
      </section>
    </div>
  )
}
