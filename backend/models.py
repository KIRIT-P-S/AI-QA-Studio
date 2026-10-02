from typing import List, Literal, Optional, Any, Dict
from pydantic import BaseModel, Field

Status = Literal["Passed", "Failed", "Warning", "Not run"]
Action = Literal[
    "navigate", "click", "fill", "select", "check",
    "assertVisible", "assertText", "assertValue",
    "assertURL", "api", "database"
]

class Step(BaseModel):
    action: Action
    target: str
    value: Optional[str] = None
    expected: Optional[str] = None
    humanApproval: Optional[bool] = None

class RequirementMapping(BaseModel):
    url: str
    confidence: float
    reason: str

class Requirement(BaseModel):
    id: str
    title: str
    description: str
    acceptanceCriteria: List[str]
    source: str
    mapping: Optional[RequirementMapping] = None

class TestCase(BaseModel):
    id: str
    requirementIds: List[str]
    title: str
    expected: str
    steps: List[Step]
    approved: bool
    kind: str
    version: int

class StepResult(Step):
    status: Status
    detail: str
    duration: int

class NetworkEntry(BaseModel):
    url: str
    method: str
    status: int
    duration: float

class Result(BaseModel):
    id: str
    runId: str
    testId: str
    version: int
    title: str
    requirementIds: List[str]
    status: Status
    expected: str
    actual: str
    impact: str
    likelyCause: str
    confidence: Optional[float] = None
    startedAt: str
    duration: int
    steps: List[StepResult]
    screenshot: Optional[str] = None
    trace: Optional[str] = None
    video: Optional[str] = None
    console: List[str]
    network: List[NetworkEntry]
    database: Optional[Any] = None

class Issue(BaseModel):
    id: str
    title: str
    testId: str
    requirementIds: List[str]
    resultIds: List[str]
    severity: Literal["Critical", "High", "Medium", "Low"]
    status: Literal["Open", "In Progress", "Fixed", "Re-testing", "Verified", "Closed"]
    notes: str
    createdAt: str

class DiscoveryElement(BaseModel):
    selector: str
    type: str
    label: str
    href: Optional[str] = None
    formMethod: Optional[str] = None
    formAction: Optional[str] = None

class DiscoveryPage(BaseModel):
    url: str
    title: str
    text: str
    elements: List[DiscoveryElement]

class Run(BaseModel):
    id: str
    status: Literal["Running", "Paused", "Completed", "Cancelled", "Error"]
    testIds: List[str]
    startedAt: str
    finishedAt: Optional[str] = None
    error: Optional[str] = None

class DocumentInfo(BaseModel):
    id: str
    name: str
    kind: str
    uploadedAt: str
    count: int

class Signoff(BaseModel):
    id: str
    name: str
    note: str
    at: str
    fingerprint: str

class QAValidation(BaseModel):
    name: str
    at: str
    fingerprint: str

class Activity(BaseModel):
    at: str
    message: str

class Project(BaseModel):
    id: str
    name: str
    description: str
    url: str
    environment: Literal["Local", "Staging", "Test"]
    owner: str
    members: List[str]
    createdAt: str
    updatedAt: str
    requirements: List[Requirement] = Field(default_factory=list)
    tests: List[TestCase] = Field(default_factory=list)
    results: List[Result] = Field(default_factory=list)
    issues: List[Issue] = Field(default_factory=list)
    runs: List[Run] = Field(default_factory=list)
    discovery: List[DiscoveryPage] = Field(default_factory=list)
    documents: List[DocumentInfo] = Field(default_factory=list)
    signoffs: List[Signoff] = Field(default_factory=list)
    qaValidation: Optional[QAValidation] = None
    activity: List[Activity] = Field(default_factory=list)

class Studio(BaseModel):
    version: Literal[1]
    projects: List[Project] = Field(default_factory=list)
