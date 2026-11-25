package storage

import (
	"fmt"
	"os"
	"path/filepath"

	toml "github.com/pelletier/go-toml/v2"
)

const ProjectsFileName = "projects.toml"

// ProjectCommand represents a single executable command inside an imported project.
type ProjectCommand struct {
	ID           string `toml:"id" json:"id"`
	Name         string `toml:"name" json:"name"`
	Command      string `toml:"command" json:"command"`
	Cwd          string `toml:"cwd,omitempty" json:"cwd"`
	Shell        string `toml:"shell,omitempty" json:"shell,omitempty"`
	Category     string `toml:"category" json:"category"`
	Pinned       bool   `toml:"pinned" json:"pinned"`
	Source       string `toml:"source" json:"source"`
	SubProject   string `toml:"sub_project,omitempty" json:"subProject,omitempty"`
	ExpectedPort int    `toml:"expected_port,omitempty" json:"expectedPort,omitempty"`
}

// ProjectRecord represents an imported local development project.
type ProjectRecord struct {
	ID         string           `toml:"id" json:"id"`
	Name       string           `toml:"name" json:"name"`
	Path       string           `toml:"path" json:"path"`
	TechStack  []string         `toml:"tech_stack" json:"techStack"`
	Commands   []ProjectCommand `toml:"commands" json:"commands"`
	Pinned     bool             `toml:"pinned,omitempty" json:"pinned"`
	AIAnalyzed bool             `toml:"ai_analyzed,omitempty" json:"aiAnalyzed"`
	CreatedAt  string           `toml:"created_at" json:"createdAt"`
	UpdatedAt  string           `toml:"updated_at" json:"updatedAt"`
}

// ProjectsFile represents the structure of projects.toml.
type ProjectsFile struct {
	FormatVersion int             `toml:"format_version"`
	Projects      []ProjectRecord `toml:"projects"`
}

func (sm *StorageManager) projectsPath() string {
	return filepath.Join(sm.baseDir, ProjectsFileName)
}

// LoadProjects loads projects.toml. If corrupted or version is newer, backs it up and returns empty slice.
func (sm *StorageManager) LoadProjects() ([]ProjectRecord, string, error) {
	p := sm.projectsPath()
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return []ProjectRecord{}, "", nil
		}
		return nil, "", fmt.Errorf("failed to read projects file: %w", err)
	}

	var pf ProjectsFile
	if err := toml.Unmarshal(data, &pf); err != nil {
		backupPath := sm.backupCorruptFile(p)
		report := fmt.Sprintf("projects.toml is corrupted (%v); backed up to %s", err, filepath.Base(backupPath))
		return []ProjectRecord{}, report, nil
	}

	if pf.FormatVersion > CurrentFormatVersion {
		backupPath := sm.backupCorruptFile(p)
		report := fmt.Sprintf("projects.toml format version %d > current supported %d; backed up to %s", pf.FormatVersion, CurrentFormatVersion, filepath.Base(backupPath))
		return []ProjectRecord{}, report, nil
	}

	if pf.Projects == nil {
		pf.Projects = []ProjectRecord{}
	}
	for i := range pf.Projects {
		if pf.Projects[i].TechStack == nil {
			pf.Projects[i].TechStack = []string{}
		}
		if pf.Projects[i].Commands == nil {
			pf.Projects[i].Commands = []ProjectCommand{}
		}
	}
	return pf.Projects, "", nil
}

// SaveProjects atomically saves the project records to projects.toml.
func (sm *StorageManager) SaveProjects(projects []ProjectRecord) error {
	pf := ProjectsFile{
		FormatVersion: CurrentFormatVersion,
		Projects:      projects,
	}
	if pf.Projects == nil {
		pf.Projects = []ProjectRecord{}
	}

	data, err := toml.Marshal(pf)
	if err != nil {
		return fmt.Errorf("failed to marshal projects to TOML: %w", err)
	}

	return sm.atomicWrite(sm.projectsPath(), data)
}
