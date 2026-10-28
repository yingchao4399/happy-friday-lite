import test from 'node:test'
import assert from 'node:assert/strict'
import {terminalTheme} from '../../src/features/typewriter/plugins/terminal-theme.js'

const ansi = {
  black: '#2b231c', red: '#9c3a2a', green: '#4c6b2f', yellow: '#8a6a1c',
  blue: '#2f5277', magenta: '#7b3f6e', cyan: '#2e6b6a', white: '#7d7060',
  lightBlack: '#6e6153', lightRed: '#b0452a', lightGreen: '#557a33', lightYellow: '#94701a',
  lightBlue: '#3a6491', lightMagenta: '#8c4a7e', lightCyan: '#317876', lightWhite: '#5b4f43'
}

test('terminal theme maps bright ANSI slots and stays readable on laid paper', () => {
  const paper = {paper: '#f1e9d6', ink: '#2a2019', ansi}
  const theme = terminalTheme(paper)
  assert.equal(theme.brightYellow, ansi.lightYellow)
  assert.equal(theme.brightMagenta, ansi.lightMagenta)
  assert.ok(!('lightYellow' in theme))
  assert.equal(theme.background, 'rgba(241, 233, 214, 0)', '保留纸色 RGB 供 xterm 校正对比度，同时保持透明纸纹')
  assert.equal(terminalTheme({...paper,paper:'rgb(30, 40, 50)'}).background,'rgba(30, 40, 50, 0)')
  assert.equal(terminalTheme({...paper,paper:'#abc'}).background,'rgba(170, 187, 204, 0)')
})
