import React, { useEffect } from 'react';
import ReactDiffViewer from 'react-diff-viewer';
import { DiffResult } from '../types';
import { I18n } from '../i18n';

interface TodoDiffViewerProps {
  diffResult: DiffResult;
  onClose: () => void;
  onConfirm: () => void;
  i18n: I18n;
}

export const TodoDiffViewer: React.FC<TodoDiffViewerProps> = ({ diffResult, onClose, onConfirm, i18n }) => {
  const { oldContent, newContent } = diffResult;
  const isDarkMode = document.body.classList.contains('theme-dark');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onConfirm();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onConfirm, onClose]);

  return (
    <div className="todo-diff-viewer">
      <div className="todo-diff-header">
        <h3>{i18n.t('modal.diffViewer.title')}</h3>
      </div>
      <div className="todo-diff-content">
        <ReactDiffViewer
          oldValue={oldContent}
          newValue={newContent}
          splitView={true}
          hideLineNumbers={false}
          showDiffOnly={true}
          useDarkTheme={isDarkMode}
        />
      </div>
      <div className="todo-diff-footer">
        <button className="mod-cta" onClick={onConfirm}>
          {i18n.t('modal.diffViewer.confirmHint')}
        </button>
        <button onClick={onClose}>
          {i18n.t('modal.diffViewer.cancelHint')}
        </button>
      </div>
    </div>
  );
}; 