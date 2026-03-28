use std::collections::HashSet;

use super::error::GitHubError;
use super::types::{GitHubEvent, PrRef};
use super::GitHubClient;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RepoEventChanges {
    pub touched_pr_numbers: Vec<i64>,
}

pub fn parse_repo_event_changes(events: &[GitHubEvent]) -> RepoEventChanges {
    let mut seen_event_ids: HashSet<&str> = HashSet::new();
    let mut seen_pr_numbers: HashSet<i64> = HashSet::new();
    let mut touched_pr_numbers = Vec::new();

    for event in events {
        if !seen_event_ids.insert(event.id.as_str()) {
            continue;
        }

        if let Some(pr_number) = extract_pr_number(event) {
            if seen_pr_numbers.insert(pr_number) {
                touched_pr_numbers.push(pr_number);
            }
        }
    }

    RepoEventChanges { touched_pr_numbers }
}

pub fn extract_authored_pr_refs_from_user_events(
    events: &[GitHubEvent],
    username: &str,
) -> Vec<PrRef> {
    let mut refs = Vec::new();

    for event in events {
        let Some((repo_owner, repo_name)) = event
            .repo
            .as_ref()
            .and_then(|repo| parse_repo_full_name(&repo.name))
        else {
            continue;
        };

        let payload = &event.payload;

        match event.event_type.as_str() {
            "PullRequestEvent" => {
                let pr = payload.get("pull_request");
                if !is_authored_by(pr, username) || is_closed(pr) {
                    continue;
                }
                if let Some(number) = json_i64(pr, "number") {
                    refs.push(PrRef {
                        repo_owner: repo_owner.to_string(),
                        repo_name: repo_name.to_string(),
                        number,
                    });
                }
            }
            "IssueCommentEvent" => {
                let issue = payload.get("issue");
                let is_pr_issue = issue.and_then(|v| v.get("pull_request")).is_some();
                if !is_pr_issue || !is_authored_by(issue, username) || is_closed(issue) {
                    continue;
                }
                if let Some(number) = json_i64(issue, "number") {
                    refs.push(PrRef {
                        repo_owner: repo_owner.to_string(),
                        repo_name: repo_name.to_string(),
                        number,
                    });
                }
            }
            "PullRequestReviewEvent" | "PullRequestReviewCommentEvent" => {
                let pr = payload.get("pull_request");
                if !is_authored_by(pr, username) || is_closed(pr) {
                    continue;
                }
                if let Some(number) = json_i64(pr, "number") {
                    refs.push(PrRef {
                        repo_owner: repo_owner.to_string(),
                        repo_name: repo_name.to_string(),
                        number,
                    });
                }
            }
            _ => {}
        }
    }

    dedupe_pr_refs(refs)
}

impl GitHubClient {
    pub async fn list_repo_events(
        &self,
        owner: &str,
        repo: &str,
        token: &str,
    ) -> Result<Vec<GitHubEvent>, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/events?per_page=100",
            owner, repo
        );
        self.get_with_etag::<Vec<GitHubEvent>>(&url, token).await
    }

    pub async fn list_user_events(
        &self,
        username: &str,
        token: &str,
    ) -> Result<Vec<GitHubEvent>, GitHubError> {
        let url = format!(
            "https://api.github.com/users/{}/events?per_page=100",
            username
        );
        self.get_with_etag::<Vec<GitHubEvent>>(&url, token).await
    }
}

pub fn dedupe_pr_refs(pr_refs: Vec<PrRef>) -> Vec<PrRef> {
    let mut seen: HashSet<(String, String, i64)> = HashSet::new();
    let mut deduped = Vec::new();
    for pr_ref in pr_refs {
        let key = (
            pr_ref.repo_owner.clone(),
            pr_ref.repo_name.clone(),
            pr_ref.number,
        );
        if seen.insert(key) {
            deduped.push(pr_ref);
        }
    }
    deduped
}

fn parse_repo_full_name(repo_name: &str) -> Option<(&str, &str)> {
    let mut parts = repo_name.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner, repo))
}

fn extract_pr_number(event: &GitHubEvent) -> Option<i64> {
    let payload = &event.payload;
    match event.event_type.as_str() {
        "PullRequestEvent" => json_i64(payload.get("pull_request"), "number"),
        "IssueCommentEvent" => {
            let issue = payload.get("issue")?;
            issue.get("pull_request")?;
            issue.get("number")?.as_i64()
        }
        "PullRequestReviewEvent" | "PullRequestReviewCommentEvent" => {
            json_i64(payload.get("pull_request"), "number")
        }
        _ => None,
    }
}

fn json_i64(root: Option<&serde_json::Value>, key: &str) -> Option<i64> {
    root?.get(key)?.as_i64()
}

fn is_authored_by(root: Option<&serde_json::Value>, username: &str) -> bool {
    root.and_then(|v| v.get("user"))
        .and_then(|v| v.get("login"))
        .and_then(|v| v.as_str())
        .map(|login| login == username)
        .unwrap_or(false)
}

fn is_closed(root: Option<&serde_json::Value>) -> bool {
    root.and_then(|v| v.get("state"))
        .and_then(|v| v.as_str())
        .map(|state| state == "closed")
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_events(json: &str) -> Vec<GitHubEvent> {
        serde_json::from_str(json).expect("events should deserialize")
    }

    #[test]
    fn test_parse_repo_event_changes_maps_pr_and_comment_activity() {
        let events = parse_events(
            r#"[
              {
                "id": "e-1",
                "type": "PullRequestEvent",
                "created_at": "2026-03-10T10:00:00Z",
                "payload": { "action": "synchronize", "pull_request": { "number": 42 } }
              },
              {
                "id": "e-2",
                "type": "IssueCommentEvent",
                "created_at": "2026-03-10T10:01:00Z",
                "payload": {
                  "action": "created",
                  "issue": { "number": 42, "pull_request": { "url": "https://api.github.com/repos/acme/repo/pulls/42" } },
                  "comment": { "id": 9001 }
                }
              },
              {
                "id": "e-3",
                "type": "PullRequestReviewEvent",
                "created_at": "2026-03-10T10:02:00Z",
                "payload": {
                  "action": "submitted",
                  "pull_request": { "number": 42 },
                  "review": { "id": 777 }
                }
              },
              {
                "id": "e-4",
                "type": "PullRequestReviewCommentEvent",
                "created_at": "2026-03-10T10:03:00Z",
                "payload": {
                  "action": "created",
                  "pull_request": { "number": 99 },
                  "comment": { "id": 888 }
                }
              }
            ]"#,
        );

        let changes = parse_repo_event_changes(&events);
        assert_eq!(changes.touched_pr_numbers, vec![42, 99]);
    }

    #[test]
    fn test_extract_authored_pr_refs_from_user_events_filters_to_authored_prs() {
        let events = parse_events(
            r#"[
              {
                "id": "u-1",
                "type": "PullRequestEvent",
                "created_at": "2026-03-10T10:00:00Z",
                "repo": { "name": "acme/core" },
                "payload": {
                  "action": "opened",
                  "pull_request": { "number": 7, "user": { "login": "octocat" } }
                }
              },
              {
                "id": "u-2",
                "type": "PullRequestEvent",
                "created_at": "2026-03-10T10:05:00Z",
                "repo": { "name": "acme/core" },
                "payload": {
                  "action": "opened",
                  "pull_request": { "number": 8, "user": { "login": "someone-else" } }
                }
              },
              {
                "id": "u-3",
                "type": "IssueCommentEvent",
                "created_at": "2026-03-10T10:08:00Z",
                "repo": { "name": "acme/core" },
                "payload": {
                  "action": "created",
                  "issue": {
                    "number": 9,
                    "pull_request": { "url": "https://api.github.com/repos/acme/core/pulls/9" },
                    "user": { "login": "octocat" }
                  }
                }
              }
            ]"#,
        );

        let refs = extract_authored_pr_refs_from_user_events(&events, "octocat");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].repo_owner, "acme");
        assert_eq!(refs[0].repo_name, "core");
        assert_eq!(refs[0].number, 7);
        assert_eq!(refs[1].number, 9);
    }

    #[test]
    fn test_parse_repo_event_changes_is_idempotent_for_duplicate_events() {
        let events = parse_events(
            r#"[
              {
                "id": "dup-1",
                "type": "IssueCommentEvent",
                "created_at": "2026-03-10T10:01:00Z",
                "payload": {
                  "action": "created",
                  "issue": { "number": 42, "pull_request": { "url": "https://api.github.com/repos/acme/repo/pulls/42" } },
                  "comment": { "id": 9001 }
                }
              },
              {
                "id": "dup-1",
                "type": "IssueCommentEvent",
                "created_at": "2026-03-10T10:01:00Z",
                "payload": {
                  "action": "created",
                  "issue": { "number": 42, "pull_request": { "url": "https://api.github.com/repos/acme/repo/pulls/42" } },
                  "comment": { "id": 9001 }
                }
              }
            ]"#,
        );

        let changes = parse_repo_event_changes(&events);
        assert_eq!(changes.touched_pr_numbers, vec![42]);
    }
}
