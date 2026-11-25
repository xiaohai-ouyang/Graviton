package envmgr

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScanProject_ViteConfigPort(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "pnpm-lock.yaml"), []byte(""), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{
		"name": "web-app",
		"scripts": {
			"dev": "vite",
			"build": "vite build"
		},
		"devDependencies": { "vite": "^6.0.0", "vue": "^3.5.0" }
	}`), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "vite.config.ts"), []byte(`
export default defineConfig({
  server: {
    host: true,
    port: 5179,
  },
})
`), 0644))

	res, err := ScanProject(dir)
	require.NoError(t, err)

	ports := map[string]int{}
	for _, c := range res.Commands {
		ports[c.Command] = c.ExpectedPort
	}
	assert.Equal(t, 5179, ports["pnpm dev"])
	assert.Equal(t, 0, ports["pnpm build"])
}

func TestScanProject_JavaMavenSpringBootWithProfileOverride(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(`
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
</project>
`), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "mvnw.cmd"), []byte("@echo off\n"), 0644))

	resDir := filepath.Join(dir, "src", "main", "resources")
	require.NoError(t, os.MkdirAll(resDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(resDir, "application.yml"), []byte(`
server:
  port: ${PORT:8080}
spring:
  profiles:
    active: dev
`), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(resDir, "application-dev.yml"), []byte(`
server:
  port: 8092
`), 0644))

	res, err := ScanProject(dir)
	require.NoError(t, err)
	assert.Contains(t, res.TechStack, "Java")
	assert.Contains(t, res.TechStack, "Maven")
	assert.Contains(t, res.TechStack, "Spring Boot")

	var foundBoot bool
	for _, c := range res.Commands {
		if c.Command == `.\mvnw.cmd spring-boot:run` {
			foundBoot = true
			assert.True(t, c.Pinned)
			assert.Equal(t, "dev", c.Category)
			assert.Equal(t, 8092, c.ExpectedPort)
		}
	}
	assert.True(t, foundBoot)
}

func TestScanProject_JavaGradleSpringBootProperties(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "build.gradle.kts"), []byte(`
plugins {
    id("org.springframework.boot") version "3.3.0"
}
`), 0644))
	resDir := filepath.Join(dir, "src", "main", "resources")
	require.NoError(t, os.MkdirAll(resDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(resDir, "application.properties"), []byte("server.port=${APP_PORT:9091}\n"), 0644))

	res, err := ScanProject(dir)
	require.NoError(t, err)
	assert.Contains(t, res.TechStack, "Java")
	assert.Contains(t, res.TechStack, "Gradle")
	assert.Contains(t, res.TechStack, "Spring Boot")

	var foundRun bool
	for _, c := range res.Commands {
		if c.Command == "gradle bootRun" {
			foundRun = true
			assert.Equal(t, 9091, c.ExpectedPort)
		}
	}
	assert.True(t, foundRun)
}

func TestScanProject_PythonPorts(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "requirements.txt"), []byte("flask\n"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "app.py"), []byte(`
from flask import Flask
app = Flask(__name__)
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5055)
`), 0644))

	res, err := ScanProject(dir)
	require.NoError(t, err)
	var found bool
	for _, c := range res.Commands {
		if c.Command == "python app.py" {
			found = true
			assert.Equal(t, 5055, c.ExpectedPort)
		}
	}
	assert.True(t, found)
}
