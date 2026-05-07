use serde::Serialize;
use std::{
    any::{Any, TypeId},
    collections::HashMap,
    ops::Deref,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use crate::app_events::RustAppEventAdapter;

#[derive(Clone, Default)]
pub struct AppHandle {
    inner: Arc<AppHandleInner>,
}

#[derive(Default)]
struct AppHandleInner {
    states: Mutex<HashMap<TypeId, &'static (dyn Any + Send + Sync)>>,
    app_data_dir: Mutex<Option<PathBuf>>,
    resource_dir: Mutex<Option<PathBuf>>,
    app_event_adapter: Mutex<Option<Arc<dyn RustAppEventAdapter>>>,
}

impl AppHandle {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub fn with_resource_dir(resource_dir: PathBuf) -> Self {
        let app = Self::default();
        app.set_resource_dir(resource_dir);
        app
    }

    pub fn with_app_paths(app_data_dir: PathBuf, resource_dir: PathBuf) -> Self {
        let app = Self::default();
        app.set_app_data_dir(app_data_dir);
        app.set_resource_dir(resource_dir);
        app
    }

    pub fn set_app_data_dir(&self, app_data_dir: PathBuf) {
        if let Ok(mut dir) = self.inner.app_data_dir.lock() {
            *dir = Some(app_data_dir);
        }
    }

    pub fn set_resource_dir(&self, resource_dir: PathBuf) {
        if let Ok(mut dir) = self.inner.resource_dir.lock() {
            *dir = Some(resource_dir);
        }
    }

    pub fn set_app_event_adapter(&self, adapter: Arc<dyn RustAppEventAdapter>) {
        if let Ok(mut current) = self.inner.app_event_adapter.lock() {
            *current = Some(adapter);
        }
    }

    pub fn has_app_event_adapter(&self) -> bool {
        self.inner
            .app_event_adapter
            .lock()
            .map(|adapter| adapter.is_some())
            .unwrap_or(false)
    }

    pub fn manage<T>(&self, state: T)
    where
        T: Any + Send + Sync + 'static,
    {
        let leaked: &'static (dyn Any + Send + Sync) = Box::leak(Box::new(state));
        if let Ok(mut states) = self.inner.states.lock() {
            states.insert(TypeId::of::<T>(), leaked);
        }
    }

    pub fn emit<T: Serialize>(&self, event_name: &str, payload: T) -> Result<(), String> {
        let payload = serde_json::to_value(payload)
            .map_err(|error| format!("failed to serialize app event payload: {error}"))?;
        let adapter = self
            .inner
            .app_event_adapter
            .lock()
            .map_err(|error| format!("app event adapter lock error: {error}"))?
            .clone();
        if let Some(adapter) = adapter {
            adapter
                .emit(event_name, payload)
                .map(|_| ())
                .map_err(|error| format!("failed to publish app event: {error:?}"))
        } else {
            Ok(())
        }
    }

    pub fn state<T>(&self) -> State<'static, T>
    where
        T: Any + Send + Sync + 'static,
    {
        self.try_state::<T>().unwrap_or_else(|| {
            panic!(
                "managed backend state not found: {}",
                std::any::type_name::<T>()
            )
        })
    }

    pub fn try_state<T>(&self) -> Option<State<'static, T>>
    where
        T: Any + Send + Sync + 'static,
    {
        let states = self.inner.states.lock().ok()?;
        let value = states.get(&TypeId::of::<T>())?;
        value.downcast_ref::<T>().map(State)
    }

    pub fn path(&self) -> AppPathResolver {
        AppPathResolver { app: self.clone() }
    }
}

#[derive(Clone)]
pub struct AppPathResolver {
    app: AppHandle,
}

impl AppPathResolver {
    pub fn app_data_dir(&self) -> Result<PathBuf, String> {
        self.app
            .inner
            .app_data_dir
            .lock()
            .map_err(|error| format!("app data dir lock error: {error}"))?
            .clone()
            .or_else(|| {
                dirs::data_dir().map(|dir| dir.join(crate::data_identity::app_data_identifier()))
            })
            .ok_or_else(|| "failed to resolve user data directory".to_string())
    }

    pub fn resource_dir(&self) -> Result<PathBuf, String> {
        self.app
            .inner
            .resource_dir
            .lock()
            .map_err(|error| format!("resource dir lock error: {error}"))?
            .clone()
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|path| path.parent().map(PathBuf::from))
            })
            .ok_or_else(|| "failed to resolve backend resource directory".to_string())
    }
}

#[derive(Clone, Copy)]
pub struct State<'a, T: ?Sized>(&'a T);

impl<'a, T: ?Sized> State<'a, T> {
    pub fn inner(&self) -> &'a T {
        self.0
    }
}

impl<T: ?Sized> Deref for State<'_, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        self.0
    }
}
