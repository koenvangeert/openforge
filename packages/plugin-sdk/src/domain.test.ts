import { describe, expect, it } from 'vitest'

import { getSkillSourcePath, groupSkillsBySource, type SkillInfo } from './domain'

function makeSkill(name: string, source_dir: string, level: SkillInfo['level'] = 'project'): SkillInfo {
  return {
    name,
    source_dir,
    level,
    description: null,
    agent: null,
    template: null,
    file_name: `${name}.md`,
  }
}

describe('skill source presentation helpers', () => {
  it('groups skills by known provider source order and appends unknown sources to other', () => {
    const skills = [
      makeSkill('custom', '.custom'),
      makeSkill('pi', '.pi'),
      makeSkill('agents', '.agents'),
      makeSkill('other-custom', '.another'),
      makeSkill('opencode', '.opencode'),
    ]

    expect(groupSkillsBySource(skills)).toEqual([
      { source: '.agents', skills: [skills[2]] },
      { source: '.opencode', skills: [skills[4]] },
      { source: '.pi', skills: [skills[1]] },
      { source: 'other', skills: [skills[0], skills[3]] },
    ])
  })

  it('formats user .pi skills from the Pi agent skill directory', () => {
    expect(getSkillSourcePath('.pi', 'user')).toBe('.pi/agent/skills')
    expect(getSkillSourcePath('.pi', 'project')).toBe('.pi/skills')
    expect(getSkillSourcePath('.agents', 'user')).toBe('.agents/skills')
  })
})
