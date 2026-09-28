// @vitest-environment happy-dom
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowOperatorPalette } from '../../src/renderer/components/data-view/data-tasks/workflow/WorkflowOperatorPalette';
import { WORKFLOW_OPERATOR_MIME } from '../../src/renderer/components/data-view/data-tasks/workflow/workflow-model';
import i18n from './i18n-test';

afterEach(cleanup);

describe('categorized operator palette', () => {
  it.each(['zh', 'en'])(
    'renders SQL in advanced compute in both languages (%s)',
    async (language) => {
      await i18n.changeLanguage(language);
      render(<WorkflowOperatorPalette />);
      const group = (category: string) =>
        screen.getByRole('region', {
          name: new RegExp(i18n.t(`data.workflow.operatorCategories.${category}`)),
        });
      expect(within(group('input_output')).getAllByRole('button')).toHaveLength(3);
      expect(within(group('data_transform')).getAllByRole('button')).toHaveLength(11);
      // Advanced compute starts collapsed — expand it before asserting members.
      const advancedGroup = group('advanced_compute');
      const advancedHeading = within(advancedGroup).getByRole('button', {
        name: new RegExp(i18n.t('data.workflow.operatorCategories.advanced_compute')),
      });
      expect(advancedHeading.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(advancedHeading);
      expect(within(advancedGroup).getAllByRole('button')).toHaveLength(8);
      expect(
        within(advancedGroup).getByRole('button', {
          name: `SQL — ${i18n.t('data.workflow.addOperatorToCanvas')}`,
        })
      ).toBeTruthy();
    }
  );

  it('collapses groups and preserves click insertion and the existing drag payload', () => {
    const onAddOperator = vi.fn();
    render(<WorkflowOperatorPalette onAddOperator={onAddOperator} />);
    const heading = screen.getByRole('button', {
      name: new RegExp(i18n.t('data.workflow.operatorCategories.input_output')),
    });
    const inputName = `${i18n.t('data.workflow.operators.input_source')} — ${i18n.t('data.workflow.addOperatorToCanvas')}`;
    fireEvent.click(heading);
    expect(heading.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: inputName })).toBeNull();
    fireEvent.click(heading);
    const input = screen.getByRole('button', { name: inputName });
    fireEvent.click(input);
    expect(onAddOperator).toHaveBeenCalledWith('input_source');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    const dragEvent = createEvent.dragStart(input, { dataTransfer });
    fireEvent(input, dragEvent);
    expect(dataTransfer.setData).toHaveBeenCalledWith(WORKFLOW_OPERATOR_MIME, 'input_source');
    expect((dragEvent as DragEvent).dataTransfer?.effectAllowed).toBe('copy');
  });
});
