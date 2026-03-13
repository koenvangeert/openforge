use dashmap::DashMap;
use once_cell::sync::Lazy;
use regex::Regex;
use std::fmt;
use std::io;
use std::path::Path;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;

// ============================================================================
// Error Type
// ============================================================================

#[derive(Debug)]
pub enum GitWorktreeError {
    WorktreeAddFailed(String),
    WorktreeRemoveFailed(String),
    CommandFailed(String),
    IoError(io::Error),
}

impl fmt::Display for GitWorktreeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GitWorktreeError::WorktreeAddFailed(msg) => {
                write!(f, "Failed to add worktree: {}", msg)
            }
            GitWorktreeError::WorktreeRemoveFailed(msg) => {
                write!(f, "Failed to remove worktree: {}", msg)
            }
            GitWorktreeError::CommandFailed(msg) => {
                write!(f, "Git command failed: {}", msg)
            }
            GitWorktreeError::IoError(e) => {
                write!(f, "IO error: {}", e)
            }
        }
    }
}

impl std::error::Error for GitWorktreeError {}

impl From<io::Error> for GitWorktreeError {
    fn from(err: io::Error) -> Self {
        GitWorktreeError::IoError(err)
    }
}

// ============================================================================
// Data Structures
// ============================================================================

// ============================================================================
// Per-Path Locking
// ============================================================================

static WORKTREE_LOCKS: Lazy<DashMap<String, Arc<Mutex<()>>>> = Lazy::new(DashMap::new);

/// Acquires a lock for the given repository path to prevent concurrent worktree operations
fn acquire_lock(repo_path: &Path) -> Arc<Mutex<()>> {
    let path_key = repo_path.to_string_lossy().to_string();
    WORKTREE_LOCKS
        .entry(path_key)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

// ============================================================================
// Worktree Operations
// ============================================================================

/// Creates a new git worktree with a new branch based on a given reference.
/// If the worktree path already exists, it's considered a successful reuse.
///
/// # Arguments
/// * `repo_path` - Path to the main git repository
/// * `worktree_path` - Path where the worktree should be created
/// * `branch_name` - Name of the new branch to create
/// * `base_ref` - Base reference (branch/commit) to branch from
///
/// # Returns
/// Ok(()) on success, or an error describing what went wrong
pub async fn create_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
    base_ref: &str,
) -> Result<(), GitWorktreeError> {
    let lock = acquire_lock(repo_path);
    let _guard = lock.lock().await;

    let prune_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("prune")
        .output()
        .await?;

    if !prune_output.status.success() {
        let stderr = String::from_utf8_lossy(&prune_output.stderr);
        println!("Warning: worktree prune failed: {}", stderr);
    }

    // Fetch latest from origin so the base ref (e.g. origin/main) is up to date
    let fetch_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("fetch")
        .arg("origin")
        .output()
        .await?;

    if !fetch_output.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_output.stderr);
        println!("Warning: git fetch origin failed: {}", stderr);
    }

    if worktree_path.exists() {
        return Ok(());
    }

    let result = try_create_worktree_inner(repo_path, worktree_path, branch_name, base_ref).await;

    if result.is_err() {
        println!("Worktree creation failed, attempting cleanup and retry...");
        
        let _ = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("remove")
            .arg("--force")
            .arg(worktree_path)
            .output()
            .await;

        let _ = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("prune")
            .output()
            .await;

        return try_create_worktree_inner(repo_path, worktree_path, branch_name, base_ref).await;
    }

    result
}

async fn try_create_worktree_inner(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
    base_ref: &str,
) -> Result<(), GitWorktreeError> {
    let add_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("add")
        .arg("-b")
        .arg(branch_name)
        .arg(worktree_path)
        .arg(base_ref)
        .output()
        .await?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(stderr.to_string()));
    }

    let _ = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("branch")
        .arg("--unset-upstream")
        .output()
        .await;

    Ok(())
}

/// Computes the standard worktree path for a PR review.
/// Convention: ~/.openforge/worktrees/{repo_name}/review-pr-{pr_number}
pub fn review_worktree_path(repo_path: &Path, pr_number: i64) -> Result<std::path::PathBuf, GitWorktreeError> {
    let home = dirs::home_dir().ok_or(GitWorktreeError::CommandFailed("Failed to get home directory".into()))?;
    let repo_name = repo_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or(GitWorktreeError::CommandFailed("Invalid repo path".into()))?;
    Ok(home
        .join(".openforge")
        .join("worktrees")
        .join(repo_name)
        .join(format!("review-pr-{}", pr_number)))
}

/// Creates a git worktree that checks out an existing remote branch for PR review.
/// Unlike `create_worktree()`, this does NOT create a new branch — it checks out
/// the existing remote branch in detached HEAD mode.
///
/// If the worktree already exists at the path, it's considered a successful reuse
/// (worktrees are kept indefinitely for fastest re-reviews).
pub async fn create_review_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    remote_branch: &str,
) -> Result<(), GitWorktreeError> {
    let lock = acquire_lock(repo_path);
    let _guard = lock.lock().await;

    let prune_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("prune")
        .output()
        .await?;

    if !prune_output.status.success() {
        let stderr = String::from_utf8_lossy(&prune_output.stderr);
        println!("Warning: worktree prune failed: {}", stderr);
    }

    // Fetch the specific branch so origin/{remote_branch} is up to date
    let fetch_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("fetch")
        .arg("origin")
        .arg(remote_branch)
        .output()
        .await?;

    if !fetch_output.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_output.stderr);
        println!("Warning: git fetch origin {} failed: {}", remote_branch, stderr);
    }

    if worktree_path.exists() {
        return Ok(());
    }

    let result = try_create_review_worktree_inner(repo_path, worktree_path, remote_branch).await;

    if result.is_err() {
        println!("Review worktree creation failed, attempting cleanup and retry...");

        let _ = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("remove")
            .arg("--force")
            .arg(worktree_path)
            .output()
            .await;

        let _ = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("prune")
            .output()
            .await;

        return try_create_review_worktree_inner(repo_path, worktree_path, remote_branch).await;
    }

    result
}

async fn try_create_review_worktree_inner(
    repo_path: &Path,
    worktree_path: &Path,
    remote_branch: &str,
) -> Result<(), GitWorktreeError> {
    let remote_ref = format!("origin/{}", remote_branch);
    let add_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("add")
        .arg(worktree_path)
        .arg(&remote_ref)
        .output()
        .await?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(stderr.to_string()));
    }

    Ok(())
}

/// Removes a git worktree and cleans up all associated metadata.
/// Performs a 4-step cleanup process to ensure complete removal.
///
/// # Arguments
/// * `repo_path` - Path to the main git repository
/// * `worktree_path` - Path to the worktree to remove
///
/// # Returns
/// Ok(()) on success, or an error describing what went wrong
pub async fn remove_worktree(
    repo_path: &Path,
    worktree_path: &Path,
) -> Result<(), GitWorktreeError> {
    remove_worktree_with_branch(repo_path, worktree_path, None).await
}

pub async fn remove_worktree_with_branch(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: Option<&str>,
) -> Result<(), GitWorktreeError> {
    let lock = acquire_lock(repo_path);
    let _guard = lock.lock().await;

    // Step 1: Force remove the worktree via git
    let remove_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg(worktree_path)
        .output()
        .await?;

    if !remove_output.status.success() {
        let stderr = String::from_utf8_lossy(&remove_output.stderr);
        println!("Warning: git worktree remove failed: {}", stderr);
    }

    // Step 2: Remove .git/worktrees metadata
    let worktree_name = worktree_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    
    let git_dir = repo_path.join(".git").join("worktrees").join(worktree_name);
    if git_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&git_dir) {
            println!("Warning: failed to remove worktree metadata: {}", e);
        }
    }

    // Step 3: Force remove the filesystem directory
    if worktree_path.exists() {
        let rm_output = Command::new("rm")
            .arg("-rf")
            .arg(worktree_path)
            .output()
            .await?;

        if !rm_output.status.success() {
            let stderr = String::from_utf8_lossy(&rm_output.stderr);
            return Err(GitWorktreeError::WorktreeRemoveFailed(stderr.to_string()));
        }
    }

    // Step 4: Prune stale worktree references
    let prune_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("prune")
        .output()
        .await?;

    if !prune_output.status.success() {
        let stderr = String::from_utf8_lossy(&prune_output.stderr);
        println!("Warning: worktree prune failed: {}", stderr);
    }

    if let Some(branch) = branch_name {
        let branch_output = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("branch")
            .arg("-D")
            .arg(branch)
            .output()
            .await?;

        if !branch_output.status.success() {
            let stderr = String::from_utf8_lossy(&branch_output.stderr);
            println!("Warning: branch delete failed for {}: {}", branch, stderr);
        }
    }

    Ok(())
}

// ============================================================================
// Branch Name Generation
// ============================================================================

/// Generates a slugified branch name from a task ID and title.
/// Converts to lowercase, replaces non-alphanumeric characters with hyphens,
/// collapses multiple hyphens, trims, and limits to 50 characters.
///
/// # Arguments
/// * `task_id` - The task identifier (e.g., "T-5", "PROJ-123")
/// * `title` - The task title (e.g., "Add Auth Module!")
///
/// # Returns
/// A branch name in the format "{task_id}/{slug}" (e.g., "T-5/add-auth-module")
///
/// # Example
/// ```
/// let branch = slugify_branch_name("T-5", "Add Auth Module!");
/// assert_eq!(branch, "T-5/add-auth-module");
/// ```
pub fn slugify_branch_name(task_id: &str, title: &str) -> String {
    let lower = title.to_lowercase();
    let re = Regex::new(r"[^a-z0-9]+").unwrap();
    let with_hyphens = re.replace_all(&lower, "-");
    let re_collapse = Regex::new(r"-+").unwrap();
    let collapsed = re_collapse.replace_all(&with_hyphens, "-");
    let trimmed = collapsed.trim_matches('-');
    let limited = if trimmed.len() > 50 {
        &trimmed[..50]
    } else {
        trimmed
    };
    let slug = limited.trim_end_matches('-');

    format!("{}/{}", task_id, slug)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slugify_branch_name_basic() {
        let result = slugify_branch_name("T-5", "Add Auth Module!");
        assert_eq!(result, "T-5/add-auth-module");
    }

    #[test]
    fn test_slugify_branch_name_special_chars() {
        let result = slugify_branch_name("PROJ-123", "Fix: Bug with @mentions & #hashtags");
        assert_eq!(result, "PROJ-123/fix-bug-with-mentions-hashtags");
    }

    #[test]
    fn test_slugify_branch_name_multiple_spaces() {
        let result = slugify_branch_name("T-1", "Multiple   Spaces   Here");
        assert_eq!(result, "T-1/multiple-spaces-here");
    }

    #[test]
    fn test_slugify_branch_name_long_title() {
        let long_title = "This is a very long title that should be truncated to fifty characters maximum";
        let result = slugify_branch_name("T-999", long_title);
        assert!(result.starts_with("T-999/"));
        let slug_part = result.strip_prefix("T-999/").unwrap();
        assert!(slug_part.len() <= 50);
        assert!(!slug_part.ends_with('-'));
    }

    #[test]
    fn test_slugify_branch_name_unicode() {
        let result = slugify_branch_name("T-7", "Add 日本語 support");
        assert_eq!(result, "T-7/add-support");
    }
}

    #[test]
    fn test_review_worktree_path() {
        let repo_path = std::path::Path::new("/some/path/my-repo");
        let result = review_worktree_path(repo_path, 42).unwrap();
        let path_str = result.to_string_lossy();
        assert!(path_str.ends_with("/.openforge/worktrees/my-repo/review-pr-42"));
    }

    #[test]
    fn test_review_worktree_path_extracts_repo_name() {
        let repo_path = std::path::Path::new("/Users/user/projects/awesome-project");
        let result = review_worktree_path(repo_path, 123).unwrap();
        let path_str = result.to_string_lossy();
        assert!(path_str.contains("awesome-project"));
        assert!(path_str.ends_with("/review-pr-123"));
    }
