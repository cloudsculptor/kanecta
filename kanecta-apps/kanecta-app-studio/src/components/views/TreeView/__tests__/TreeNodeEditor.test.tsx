import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TreeNodeEditor } from '../TreeNodeEditor';

const noop = () => {};
const asyncNoop = async () => {};

describe('TreeNodeEditor', () => {
  it('renders an input with the current value', () => {
    render(
      <TreeNodeEditor
        value="hello"
        onChange={noop}
        onCommit={asyncNoop}
        onAbort={noop}
        onEnter={noop}
        onIndent={noop}
        onOutdent={noop}
        onDeleteEmpty={noop}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('hello');
  });

  it('calls onChange on input', async () => {
    const onChange = vi.fn();
    render(
      <TreeNodeEditor
        value=""
        onChange={onChange}
        onCommit={asyncNoop}
        onAbort={noop}
        onEnter={noop}
        onIndent={noop}
        onOutdent={noop}
        onDeleteEmpty={noop}
      />,
    );
    await userEvent.type(screen.getByRole('textbox'), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('calls onEnter on Enter key', async () => {
    const onEnter = vi.fn();
    render(
      <TreeNodeEditor
        value="text"
        onChange={noop}
        onCommit={asyncNoop}
        onAbort={noop}
        onEnter={onEnter}
        onIndent={noop}
        onOutdent={noop}
        onDeleteEmpty={noop}
      />,
    );
    await userEvent.keyboard('{Enter}');
    expect(onEnter).toHaveBeenCalled();
  });

  it('calls onIndent on Tab', async () => {
    const onIndent = vi.fn();
    render(
      <TreeNodeEditor
        value="text"
        onChange={noop}
        onCommit={asyncNoop}
        onAbort={noop}
        onEnter={noop}
        onIndent={onIndent}
        onOutdent={noop}
        onDeleteEmpty={noop}
      />,
    );
    await userEvent.keyboard('{Tab}');
    expect(onIndent).toHaveBeenCalled();
  });

  it('calls onOutdent on Shift+Tab', async () => {
    const onOutdent = vi.fn();
    render(
      <TreeNodeEditor
        value="text"
        onChange={noop}
        onCommit={asyncNoop}
        onAbort={noop}
        onEnter={noop}
        onIndent={noop}
        onOutdent={onOutdent}
        onDeleteEmpty={noop}
      />,
    );
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(onOutdent).toHaveBeenCalled();
  });

  it('calls onAbort on Escape', async () => {
    const onAbort = vi.fn();
    render(
      <TreeNodeEditor
        value="text"
        onChange={noop}
        onCommit={asyncNoop}
        onAbort={onAbort}
        onEnter={noop}
        onIndent={noop}
        onOutdent={noop}
        onDeleteEmpty={noop}
      />,
    );
    await userEvent.keyboard('{Escape}');
    expect(onAbort).toHaveBeenCalled();
  });

  it('calls onDeleteEmpty on Backspace when value is empty', async () => {
    const onDeleteEmpty = vi.fn();
    render(
      <TreeNodeEditor
        value=""
        onChange={noop}
        onCommit={asyncNoop}
        onAbort={noop}
        onEnter={noop}
        onIndent={noop}
        onOutdent={noop}
        onDeleteEmpty={onDeleteEmpty}
      />,
    );
    await userEvent.keyboard('{Backspace}');
    expect(onDeleteEmpty).toHaveBeenCalled();
  });
});
