import assert from 'node:assert/strict'
import test from 'node:test'
import { fileExtension, unsupportedFileReason } from './validate'

test('fileExtension extracts a lowercase extension', () => {
  assert.equal(fileExtension('photo.JPG'), 'jpg')
  assert.equal(fileExtension('dir/recording.MOV'), 'mov')
  assert.equal(fileExtension('no-extension'), '')
  assert.equal(fileExtension('.hidden'), '')
  assert.equal(fileExtension('trailing.'), '')
})

test('unsupportedFileReason rejects unknown extensions and allows supported ones', () => {
  assert.equal(unsupportedFileReason('OctoUpdater.exe'), 'Unsupported file type')
  assert.equal(unsupportedFileReason('PHINEAS FULL.wav'), 'Unsupported file type')
  assert.equal(unsupportedFileReason('photo.jpg'), null)
  assert.equal(unsupportedFileReason('movie.mp4'), null)
  assert.equal(unsupportedFileReason('doc.pdf'), null)
  assert.equal(unsupportedFileReason('screenshot.PNG'), null)
  assert.equal(unsupportedFileReason('no-extension-file'), null)
})
