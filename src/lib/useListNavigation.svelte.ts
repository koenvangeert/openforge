export interface ListNavigationConfig {
  get itemCount(): number
  get selectedIndex(): number
  set selectedIndex(index: number)
  wrap?: boolean
  onSelect?: () => void
  onCancel?: () => void
}

export function useListNavigation(config: ListNavigationConfig) {
  function handleKeydown(e: KeyboardEvent): boolean {
    const count = config.itemCount
    
    if (count === 0 && e.key !== 'Escape') {
      return false
    }

    if (e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'j' || e.key === 'n'))) {
      e.preventDefault()
      e.stopPropagation()
      
      if (count > 0) {
        let nextIndex = config.selectedIndex + 1
        if (config.wrap) {
          nextIndex = nextIndex % count
        } else {
          nextIndex = Math.min(nextIndex, count - 1)
        }
        config.selectedIndex = nextIndex
      }
      return true
    }
    
    if (e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'k' || e.key === 'p'))) {
      e.preventDefault()
      e.stopPropagation()
      
      if (count > 0) {
        let prevIndex = config.selectedIndex - 1
        if (config.wrap) {
          prevIndex = prevIndex < 0 ? count - 1 : prevIndex
        } else {
          prevIndex = Math.max(prevIndex, 0)
        }
        config.selectedIndex = prevIndex
      }
      return true
    }
    
    if (e.key === 'Enter') {
      if (config.onSelect) {
        e.preventDefault()
        e.stopPropagation()
        config.onSelect()
        return true
      }
    }
    
    if (e.key === 'Escape') {
      if (config.onCancel) {
        e.preventDefault()
        e.stopPropagation()
        config.onCancel()
        return true
      }
    }
    
    return false
  }

  return { handleKeydown }
}
