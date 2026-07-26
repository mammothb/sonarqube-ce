import { afterEach, describe, expect, it, vi } from 'vitest'
import * as core from '../__fixtures__/core.js'
import * as waitFixture from '../__fixtures__/wait.js'

vi.mock('@actions/core', async () => {
  return await import('../__fixtures__/core.js')
})

vi.mock('../src/wait.js', async () => {
  return await import('../__fixtures__/wait.js')
})

// Dynamic import after mocks are registered so the module under test
// gets the mocked dependencies.
const { run } = await import('../src/main.js')

describe('main.ts', () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('Sets the time output', async () => {
    core.getInput.mockReturnValue('500')
    waitFixture.wait.mockResolvedValue('done!')

    await run()

    expect(core.setOutput).toHaveBeenNthCalledWith(
      1,
      'time',
      expect.stringMatching(/^\d{2}:\d{2}:\d{2}/)
    )
  })

  it('Sets a failed status', async () => {
    core.getInput.mockReturnValue('this is not a number')
    waitFixture.wait.mockRejectedValue(
      new Error('milliseconds is not a number')
    )

    await run()

    expect(core.setFailed).toHaveBeenNthCalledWith(
      1,
      'milliseconds is not a number'
    )
  })
})
