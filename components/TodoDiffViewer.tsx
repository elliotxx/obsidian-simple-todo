import React, { useEffect } from 'react';
import ReactDiffViewer from 'react-diff-viewer';
import { DiffResult } from '../types';

interface TodoDiffViewerProps {
  diffResult: DiffResult;
  onClose: () => void;
  onConfirm: () => void;
}

export const TodoDiffViewer: React.FC<TodoDiffViewerProps> = ({ diffResult, onClose, onConfirm }) => {
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
        <h3>变更对比</h3>
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
        <button className="mod-cta" onClick={onConfirm}>确认 (Enter)</button>
        <button onClick={onClose}>取消 (Esc)</button>
      </div>
    </div>
  );
}; 